"use strict";

const fs = require("fs");
const path = require("path");
const { saveFileToCdn } = require("../utils/cdnUploader");

const LETTER_BY_INDEX = {
  "1": "A",
  "2": "B",
  "3": "C",
  "4": "D",
};

const DIFFICULTY_BY_COMPLEXITY = {
  1: "low",
  2: "low",
  3: "medium",
  4: "high",
  5: "high",
};

const IMAGE_COLUMN_BY_BUCKET = {
  question: "question_image_url",
  option1: "option1_image_url",
  option2: "option2_image_url",
  option3: "option3_image_url",
  option4: "option4_image_url",
  explanation: "explanation_image_url",
};

const IMAGE_TYPE_SUFFIX = {
  question_image_url: "supporting_picture",
  option1_image_url: "image_option_1",
  option2_image_url: "image_option_2",
  option3_image_url: "image_option_3",
  option4_image_url: "image_option_4",
  explanation_image_url: "solution_supporting_picture",
};

function ensureApp(app) {
  if (!app || typeof app.post !== "function") {
    throw new Error("uploadId route requires a valid Express app instance");
  }
}

function toNullable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return value;
}

function sanitizeForeignKey(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
}

function normalizeRequestBody(body) {
  if (Array.isArray(body)) {
    return { payload: body, meta: {} };
  }

  if (body && typeof body === "object") {
    if (Array.isArray(body.payload)) {
      const { payload, ...meta } = body;
      return { payload, meta };
    }

    if (Array.isArray(body.questions)) {
      const { questions, ...meta } = body;
      return { payload: questions, meta };
    }
  }

  return { payload: null, meta: {} };
}

function flattenQuestions(payload) {
  if (!payload) return [];
  const stack = Array.isArray(payload) ? [...payload] : [payload];
  const questions = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    if (Array.isArray(current.questions)) {
      stack.push(...current.questions);
      continue;
    }

    if (current.data && Array.isArray(current.data.questions)) {
      stack.push(...current.data.questions);
      continue;
    }

    if (
      typeof current === "object" &&
      (current.question_text || current.option_1 || current.answers)
    ) {
      questions.push(current);
    }
  }

  return questions;
}

function mapDifficulty(complexity) {
  const normalized = Number(complexity);
  if (!Number.isFinite(normalized)) return null;
  return DIFFICULTY_BY_COMPLEXITY[normalized] || null;
}

function extractFileName(value) {
  const normalized = toNullable(value);
  if (!normalized) return null;

  const fromUrl = (() => {
    try {
      if (/^https?:\/\//i.test(normalized)) {
        const parsed = new URL(normalized);
        return parsed.pathname.split("/").filter(Boolean).pop() || null;
      }
    } catch (_err) {
      return null;
    }
    return null;
  })();

  if (fromUrl) return fromUrl;

  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function deriveNewImageName(questionId, columnKey, sourceName) {
  const suffix = IMAGE_TYPE_SUFFIX[columnKey];
  if (!suffix) return null;
  const ext = path.extname(sourceName || "") || ".png";
  return `${questionId}_${suffix}${ext}`;
}

async function uploadImagesForQuestion(resolved, questionId) {
  const updates = {};
  for (const [bucket, entry] of Object.entries(resolved)) {
    if (!entry || !entry.fileName || !entry.filePath) continue;
    const columnKey = IMAGE_COLUMN_BY_BUCKET[bucket];
    if (!columnKey) continue;
    const newFileName = deriveNewImageName(questionId, columnKey, entry.fileName);
    if (!newFileName) continue;
    await saveFileToCdn(entry.filePath, newFileName);
    updates[columnKey] = newFileName;
  }
  return updates;
}

async function updateQuestionImageColumns(executeQuery, questionId, columns) {
  const entries = Object.entries(columns).filter(
    ([, value]) => value !== null && value !== undefined
  );
  if (entries.length === 0) return;
  const setClause = entries.map(([column]) => `${column} = ?`).join(", ");
  const params = entries.map(([, value]) => value);
  params.push(questionId);
  await executeQuery(`UPDATE questions SET ${setClause} WHERE id = ?`, params);
}

function collectImageNames(rawQuestion) {
  return {
    question: extractFileName(rawQuestion.supporting_picture),
    option1: extractFileName(rawQuestion.image_option_1),
    option2: extractFileName(rawQuestion.image_option_2),
    option3: extractFileName(rawQuestion.image_option_3),
    option4: extractFileName(rawQuestion.image_option_4),
    explanation: extractFileName(rawQuestion.solution_supporting_picture),
  };
}

function resolveImageCandidates(folderDir, imageNames) {
  const resolved = {};
  const missing = [];

  for (const [bucket, name] of Object.entries(imageNames)) {
    if (!name) {
      resolved[bucket] = null;
      continue;
    }

    const sanitized = path.basename(name);
    const fullPath = path.join(folderDir, sanitized);
    if (!fs.existsSync(fullPath)) {
      missing.push({ bucket, file: sanitized });
      resolved[bucket] = null;
      continue;
    }

    resolved[bucket] = { fileName: sanitized, filePath: fullPath };
  }

  return { resolved, missing };
}

function deriveCorrectOption(questionType, answers, fallback) {
  const pool = Array.isArray(answers) ? answers : answers != null ? [answers] : [];
  const first = pool.length > 0 ? pool[0] : fallback;
  if (first == null) return null;

  if (Number(questionType) === 0) {
    const asString = String(first).trim();
    if (asString.length === 1) {
      const upper = asString.toUpperCase();
      if (["A", "B", "C", "D"].includes(upper)) {
        return upper;
      }
    }
    const fromIndex = LETTER_BY_INDEX[String(first)];
    if (fromIndex) return fromIndex;
    const numeric = Number(first);
    if (Number.isFinite(numeric)) {
      return LETTER_BY_INDEX[String(Math.trunc(numeric))] || null;
    }
    return null;
  }

  if (typeof first === "string") {
    const trimmed = first.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof first === "number") {
    return String(first);
  }

  return null;
}

function normalizeQuestionType(rawType) {
  const numeric = Number(rawType);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPreviousPapers(previousPapers) {
  if (!Array.isArray(previousPapers)) return [];

  return previousPapers.map((paper) => {
    if (paper && typeof paper === "object") {
      return {
        paper_name: paper.paper_name || paper.name || paper.title || "",
        year: paper.year ?? null,
      };
    }

    if (typeof paper === "string") {
      const match = paper.match(/(\d{2})$/);
      if (match) {
        const lastTwoDigits = parseInt(match[1], 10);
        if (!Number.isNaN(lastTwoDigits) && lastTwoDigits >= 10 && lastTwoDigits <= 30) {
          return {
            paper_name: paper.replace(/'\d{2}$/, "").trim(),
            year: 2000 + lastTwoDigits,
          };
        }
      }
      return { paper_name: paper, year: null };
    }

    return { paper_name: "", year: null };
  });
}

async function resolvePreviousExamIds(executeQuery, previousPapers) {
  const formatted = formatPreviousPapers(previousPapers).filter(
    (paper) => paper.paper_name && paper.paper_name.trim().length > 0
  );
  if (formatted.length === 0) return null;

  const conditions = formatted
    .map((paper) => (paper.year ? "(paper_name = ? AND year = ?)" : "(paper_name = ?)"))
    .join(" OR ");
  const values = formatted.flatMap((paper) =>
    paper.year ? [paper.paper_name.trim(), paper.year] : [paper.paper_name.trim()]
  );

  const sql = `SELECT id FROM previous_year_exams WHERE ${conditions}`;
  const rows = await executeQuery(sql, values);
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const ids = normalizedRows
    .map((row) => row.id)
    .filter((id) => id !== undefined && id !== null);

  return ids.length > 0 ? JSON.stringify(ids) : null;
}

async function questionExistsByOldId(executeQuery, questionId) {
  if (questionId == null) return false;
  const results = await executeQuery(
    "SELECT COUNT(*) AS count FROM question_id_mapping WHERE old_question_id = ?",
    [questionId]
  );
  const row = Array.isArray(results) ? results[0] : results;
  return Boolean(row && row.count > 0);
}

async function insertQuestion(executeQuery, question) {
  const sql = `
    INSERT INTO questions (
      selectedChapterId,
      selectedSubjectId,
      selectedYearId,
      selectedTopicId,
      pre_question_text,
      option1_text,
      option2_text,
      option3_text,
      option4_text,
      correct_option,
      pre_explanation_text,
      question_image_url,
      option1_image_url,
      option2_image_url,
      option3_image_url,
      option4_image_url,
      verified_status,
      difficulty_level,
      explanation_image_url,
      question_type,
      previousPapers
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const params = [
    question.selectedChapterId,
    question.selectedSubjectId,
    question.selectedYearId,
    question.selectedTopicId,
    question.pre_question_text,
    question.option1_text,
    question.option2_text,
    question.option3_text,
    question.option4_text,
    question.correct_option,
    question.pre_explanation_text,
    question.question_image_url,
    question.option1_image_url,
    question.option2_image_url,
    question.option3_image_url,
    question.option4_image_url,
    question.verified_status,
    question.difficulty_level,
    question.explanation_image_url,
    question.question_type,
    question.previousPapers,
  ];

  const result = await executeQuery(sql, params);
  const row = Array.isArray(result) ? result[0] : result;
  return row && row.insertId ? row.insertId : result.insertId;
}

async function insertMapping(executeQuery, oldQuestionId, newQuestionId) {
  await executeQuery(
    `
    INSERT INTO question_id_mapping (
      old_question_id,
      new_question_id
    ) VALUES (?, ?)
  `,
    [oldQuestionId, newQuestionId]
  );
}

async function buildQuestionPayload(executeQuery, rawQuestion, context, images = {}) {
  const questionType = normalizeQuestionType(rawQuestion.question_type);
  const correctOption = deriveCorrectOption(
    questionType,
    rawQuestion.answers,
    rawQuestion.correct_option
  );
  if (!correctOption) {
    throw new Error("Missing or invalid correct option");
  }

  const imageValues = images || {};
  const previousPaperIds = await resolvePreviousExamIds(
    executeQuery,
    rawQuestion?.tags?.previousPapers
  );

  return {
    selectedChapterId: context.selectedChapterId,
    selectedSubjectId: context.selectedSubjectId,
    selectedYearId: context.selectedYearId,
    selectedTopicId: context.selectedTopicId,
    pre_question_text: toNullable(rawQuestion.question_text),
    option1_text: toNullable(rawQuestion.option_1),
    option2_text: toNullable(rawQuestion.option_2),
    option3_text: toNullable(rawQuestion.option_3),
    option4_text: toNullable(rawQuestion.option_4),
    correct_option: correctOption,
    pre_explanation_text: toNullable(rawQuestion.solution_text),
    question_image_url: imageValues.question || null,
    option1_image_url: imageValues.option1 || null,
    option2_image_url: imageValues.option2 || null,
    option3_image_url: imageValues.option3 || null,
    option4_image_url: imageValues.option4 || null,
    verified_status: "not_verified",
    difficulty_level: mapDifficulty(rawQuestion.complexity ?? rawQuestion.difficulty_level),
    explanation_image_url: imageValues.explanation || null,
    question_type: questionType,
    previousPapers: previousPaperIds,
  };
}

function requireContextIds(context) {
  const missing = [];
  if (!context.selectedYearId) missing.push("yearId");
  if (!context.selectedSubjectId) missing.push("subjectId");
  if (!context.selectedChapterId) missing.push("chapterId");
  if (!context.selectedTopicId) missing.push("topicId");
  return missing;
}

module.exports = function registerUploadId(app, { executeQuery, idFolderDir } = {}) {
  ensureApp(app);
  if (typeof executeQuery !== "function") {
    throw new Error("uploadId route requires executeQuery helper");
  }

  const folderDir = idFolderDir
    ? path.resolve(idFolderDir)
    : path.resolve(__dirname, "id_folder");

  app.post("/upload/id", async (req, res) => {
    try {
      const { payload, meta } = normalizeRequestBody(req.body);
      if (!payload) {
        return res.status(400).json({ error: "Request must include a payload property" });
      }

      const context = {
        mode: toNullable(meta.mode ?? req.body?.mode ?? null),
        selectedYearId: sanitizeForeignKey(meta.yearId ?? req.body?.yearId),
        selectedSubjectId: sanitizeForeignKey(meta.subjectId ?? req.body?.subjectId),
        selectedChapterId: sanitizeForeignKey(meta.chapterId ?? req.body?.chapterId),
        selectedTopicId: sanitizeForeignKey(meta.topicId ?? req.body?.topicId),
      };

      const missingContext = requireContextIds(context);
      if (missingContext.length > 0) {
        return res.status(400).json({
          error: `Missing selection metadata: ${missingContext.join(", ")}`,
        });
      }

      const questions = flattenQuestions(payload);
      if (questions.length === 0) {
        return res
          .status(400)
          .json({ error: "Payload must contain at least one question entry" });
      }

      const inserted = [];
      const duplicates = [];
      const validationErrors = [];
      const failed = [];

      for (const rawQuestion of questions) {
        try {
          const originalId = rawQuestion?.id;
          const normalizedId = Number(originalId);
          if (!Number.isFinite(normalizedId)) {
            validationErrors.push({
              question: rawQuestion,
              reason: "Missing or invalid question id",
            });
            continue;
          }

          const exists = await questionExistsByOldId(executeQuery, normalizedId);
          if (exists) {
            duplicates.push({
              old_question_id: normalizedId,
              reason: "Question already uploaded",
            });
            continue;
          }

          const imageNames = collectImageNames(rawQuestion);
          const { resolved: resolvedImages, missing: missingImages } = resolveImageCandidates(
            folderDir,
            imageNames
          );

          if (missingImages.length > 0) {
            validationErrors.push({
              question: rawQuestion,
              reason: `Missing images in id_folder: ${missingImages
                .map((item) => `${item.bucket}:${item.file}`)
                .join(", ")}`,
            });
            continue;
          }

          const questionPayload = await buildQuestionPayload(
            executeQuery,
            rawQuestion,
            context,
            null
          );
          const newQuestionId = await insertQuestion(executeQuery, questionPayload);

          try {
            const imageUpdates = await uploadImagesForQuestion(resolvedImages, newQuestionId);
            await updateQuestionImageColumns(executeQuery, newQuestionId, imageUpdates);
          } catch (imageError) {
            await executeQuery("DELETE FROM questions WHERE id = ?", [newQuestionId]).catch(() => {});
            validationErrors.push({
              question: rawQuestion,
              reason: `CDN upload failed: ${imageError?.message || imageError}`,
            });
            continue;
          }

          await insertMapping(executeQuery, normalizedId, newQuestionId);

          inserted.push({
            old_question_id: normalizedId,
            new_question_id: newQuestionId,
          });
        } catch (error) {
          console.error("[upload/id] Failed to ingest question:", error);
          failed.push({
            question_id: rawQuestion?.id ?? null,
            reason: error?.message || "Unknown error",
          });
        }
      }

      const message = `${inserted.length} question${
        inserted.length === 1 ? "" : "s"
      } uploaded, ${duplicates.length} duplicate${
        duplicates.length === 1 ? "" : "s"
      } skipped, ${validationErrors.length + failed.length} error${
        validationErrors.length + failed.length === 1 ? "" : "s"
      }.`;

      return res.json({
        message,
        inserted,
        duplicates,
        validation_errors: validationErrors,
        failed,
        id_folder_dir: folderDir,
      });
    } catch (err) {
      console.error("[upload/id] Unexpected error:", err);
      return res.status(500).json({ error: "Failed to process ID upload payload" });
    }
  });
};
