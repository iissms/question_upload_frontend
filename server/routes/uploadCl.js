"use strict";

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const LETTER_BY_INDEX = {
  "1": "A",
  "2": "B",
  "3": "C",
  "4": "D",
};

const DIFFICULTY_BY_LEVEL = {
  1: "low",
  2: "medium",
  3: "medium",
  4: "high",
};

const PREVIOUS_PAPER_MAPPING = {
  "2023 - JEE": 131,
  "2023 - Jee": 131,
  "2023 - KCET": 133,
  "2023 - KECT": 133,
  "2023 - NEET": 132,
  "2023 - TS EAMCET": 146,
  "2023 - TSEAMCET": 149,
  "2024 - JEE": 134,
  "2024 - JEE Main": 134,
  "2024 - KCET": 136,
  "2024 - NEET": 135,
  "2024 - TS EAMCET": 147,
  "2024 - TSEAMCET": 150,
  "2025 - JEE": 137,
  "2025 - JEE Main": 137,
  "2025 - KCET": 139,
  "2025 - NEET": 138,
};

const FALLBACK_SUFFIX_BY_BUCKET = {
  question: "supporting_picture",
  explanation: "explanation_img",
  option1: "op1_img",
  option2: "op2_img",
  option3: "op3_img",
  option4: "op4_img",
};

const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"];

const REMOTE_UPLOAD_URL =
  process.env.REMOTE_UPLOAD_URL || "http://93.127.185.147:3051/upload";

const fsp = fs.promises;

const EXTENSION_MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

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

function parseId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : null;
}

function toNullable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  return value;
}

// Coerce to positive INTEGER id (e.g., "9" -> 9, "27.0" -> 27)
function sanitizeForeignKey(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

// Keep, but we'll no longer use it for IDs
function resolveClassificationId(question, contextValue, keys = []) {
  if (question && typeof question === "object") {
    for (const key of keys) {
      if (key in question) {
        const candidate = sanitizeForeignKey(question[key]);
        if (candidate) return candidate;
      }
    }
  }
  const fallback = sanitizeForeignKey(contextValue);
  return fallback || null;
}

// Keep, but we'll no longer use it for IDs
function resolveYearId(question, contextValue) {
  if (question && typeof question === "object") {
    const candidates = [
      question.selectedYearId,
      question.year_id,
      question.yearId,
      question.year,
      question.ncert_id,
      question.stNcert,
    ];
    for (const value of candidates) {
      const candidate = sanitizeForeignKey(value);
      if (candidate) return candidate;
    }
  }
  return sanitizeForeignKey(contextValue);
}

function pickCorrectOption(questionType, answer) {
  const normalized = toNullable(answer);
  if (normalized == null) return null;
  if (questionType === 0) {
    const trimmed = String(normalized).trim();
    if (trimmed.length === 1) {
      const upper = trimmed.toUpperCase();
      if (["A", "B", "C", "D"].includes(upper)) {
        return upper;
      }
    }
    const letter = LETTER_BY_INDEX[String(trimmed)] || null;
    return letter;
  }
  return String(normalized);
}

function extractImageNames(question) {
  return {
    question: toNullable(question.supporting_picture),
    explanation: toNullable(question.explanation_img),
    option1: toNullable(question.op1_img),
    option2: toNullable(question.op2_img),
    option3: toNullable(question.op3_img),
    option4: toNullable(question.op4_img),
  };
}

function computeQuestionType(rawType) {
  return Number(rawType) === 5 ? 1 : 0;
}

function isRemoteUrl(value) {
  if (typeof value !== "string") return false;
  return value.startsWith("http://") || value.startsWith("https://");
}

function extractFileNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/");
    const candidate = parts[parts.length - 1];
    return candidate && candidate.length > 0 ? candidate : null;
  } catch (_error) {
    return null;
  }
}

function deriveDifficulty(levelId) {
  const normalized = toNullable(levelId);
  if (normalized == null) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return null;
  return DIFFICULTY_BY_LEVEL[numeric] || null;
}

function derivePreviousPapers(year, otherCet) {
  const normalizedYear = toNullable(year);
  const normalizedExam = toNullable(otherCet);
  if (normalizedYear == null || normalizedExam == null) return null;
  const yearPart = typeof normalizedYear === "string" ? normalizedYear : String(normalizedYear);
  const examPart = typeof normalizedExam === "string" ? normalizedExam : String(normalizedExam);
  const key = `${yearPart} - ${examPart}`;
  const mapped = PREVIOUS_PAPER_MAPPING[key];
  return mapped != null ? [mapped] : null;
}

function resolveImageFileName(cbId, bucket, providedFileName, folderDir) {
  const suffix = FALLBACK_SUFFIX_BY_BUCKET[bucket];
  const derivedCandidates = [];

  if (cbId != null && suffix) {
    for (const ext of SUPPORTED_IMAGE_EXTENSIONS) {
      derivedCandidates.push(`${cbId}_${suffix}${ext}`);
    }
  }

  for (const candidate of derivedCandidates) {
    const fullPath = path.join(folderDir, candidate);
    if (fs.existsSync(fullPath)) {
      return { resolvedName: candidate, exists: true };
    }
  }

  if (derivedCandidates.length > 0) {
    return { resolvedName: derivedCandidates[0], exists: false };
  }

  if (providedFileName && !isRemoteUrl(providedFileName)) {
    const candidate = providedFileName;
    const fullPath = path.join(folderDir, candidate);
    return { resolvedName: candidate, exists: fs.existsSync(fullPath) };
  }

  if (providedFileName && isRemoteUrl(providedFileName)) {
    const fromUrl = extractFileNameFromUrl(providedFileName);
    if (fromUrl) {
      const fullPath = path.join(folderDir, fromUrl);
      return { resolvedName: fromUrl, exists: fs.existsSync(fullPath) };
    }
  }

  return { resolvedName: null, exists: false };
}

async function uploadFileToRemote(filePath, fileName) {
  try {
    const buffer = await fsp.readFile(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const mimeType = EXTENSION_MIME_MAP[ext] || "application/octet-stream";
    const dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
    await axios.post(REMOTE_UPLOAD_URL, {
      base64: dataUri,
      filename: fileName,
    });
    console.log(`[upload/cb] Uploaded ${fileName} to remote server`);
  } catch (err) {
    console.error(
      `[upload/cb] Remote upload failed for ${fileName}:`,
      err?.message || err
    );
    throw err;
  }
}

async function uploadResolvedImagesToRemote(folderDir, images) {
  for (const fileName of Object.values(images)) {
    if (!fileName) continue;
    const fullPath = path.join(folderDir, fileName);
    await uploadFileToRemote(fullPath, fileName);
  }
}

async function questionExistsByCbId(executeQuery, cbId) {
  if (!cbId && cbId !== 0) return false;
  const sql = "SELECT COUNT(*) AS count FROM question_id_mapping WHERE cb_id = ?";
  const results = await executeQuery(sql, [cbId]);
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
      explanation_image_url,
      question_type,
      verified_status,
      difficulty_level,
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
    question.explanation_image_url,
    question.question_type,
    question.verified_status,
    question.difficulty_level,
    question.previousPapers,
  ];

  const result = await executeQuery(sql, params);
  const row = Array.isArray(result) ? result[0] : result;
  return row && row.insertId ? row.insertId : result.insertId;
}

async function insertMapping(executeQuery, cbId, newQuestionId) {
  const sql = `
    INSERT INTO question_id_mapping (
      cb_id,
      new_question_id
    ) VALUES (?, ?)
  `;
  await executeQuery(sql, [cbId, newQuestionId]);
}

function ensureApp(app) {
  if (!app || typeof app.post !== "function") {
    throw new Error("uploadCl route requires a valid Express app instance");
  }
}

module.exports = function registerUploadCl(app, { executeQuery, cbFolderDir } = {}) {
  ensureApp(app);
  if (typeof executeQuery !== "function") {
    throw new Error("uploadCl route requires executeQuery helper");
  }

  const folderDir = cbFolderDir
    ? path.resolve(cbFolderDir)
    : path.resolve(__dirname, "cb_folder");

  app.post("/upload/cb", async (req, res) => {
    const { payload, meta } = normalizeRequestBody(req.body);
    if (!payload || payload.length === 0) {
      return res
        .status(400)
        .json({ error: "Request must include a non-empty payload array" });
    }

    // Meta → positive integers only
    const context = {
      mode: toNullable(meta.mode ?? meta.type ?? null),
      selectedYearId: sanitizeForeignKey(meta.yearId ?? meta.year_id ?? meta.selectedYearId),
      selectedSubjectId: sanitizeForeignKey(meta.subjectId ?? meta.subject_id ?? meta.selectedSubjectId),
      selectedChapterId: sanitizeForeignKey(meta.chapterId ?? meta.chapter_id ?? meta.selectedChapterId),
      selectedTopicId: sanitizeForeignKey(meta.topicId ?? meta.topic_id ?? meta.selectedTopicId),
    };

    const inserted = [];
    const duplicates = [];
    const skippedMissingImages = [];
    const validationErrors = [];

    for (const rawQuestion of payload) {
      try {
        const cbId = rawQuestion?.id;
        if (cbId == null) {
          validationErrors.push({
            question: rawQuestion,
            reason: "Missing question id",
          });
          continue;
        }

        const already = await questionExistsByCbId(executeQuery, cbId);
        if (already) {
          duplicates.push({ cb_id: cbId, reason: "Question already uploaded" });
          continue;
        }

        const difficultyLevel = deriveDifficulty(rawQuestion.level_id);
        const previousPapers = derivePreviousPapers(
          rawQuestion.year,
          rawQuestion.other_cet
        );

        const questionType = computeQuestionType(rawQuestion.qtype_id);
        const correctOption = pickCorrectOption(questionType, rawQuestion.answer);

        if (questionType === 0 && !correctOption) {
          validationErrors.push({ cb_id: cbId, reason: "Invalid correct option for MCQ" });
          continue;
        }
        if (questionType === 1 && (!correctOption || String(correctOption).trim().length === 0)) {
          validationErrors.push({ cb_id: cbId, reason: "Numeric question requires an answer" });
          continue;
        }

        // image existence check
        const rawImages = extractImageNames(rawQuestion);
        const images = {};
        const missing = [];
        for (const [bucket, providedFileName] of Object.entries(rawImages)) {
          if (!providedFileName) {
            images[bucket] = null;
            continue;
          }

          const { resolvedName, exists } = resolveImageFileName(
            cbId,
            bucket,
            providedFileName,
            folderDir
          );

          images[bucket] = resolvedName;
          const reportedFile = resolvedName || providedFileName;

          if (exists) {
            console.log(
              `Question ${cbId}: image '${reportedFile}' for '${bucket}' exists in cb_folder`
            );
          } else {
            missing.push({ bucket, file: reportedFile });
            console.warn(
              `Question ${cbId}: image '${reportedFile}' for '${bucket}' missing in cb_folder`
            );
          }
        }
        if (missing.length > 0) {
          skippedMissingImages.push({ cb_id: cbId, missing_images: missing });
          continue;
        }

        try {
          await uploadResolvedImagesToRemote(folderDir, images);
        } catch (error) {
          validationErrors.push({
            cb_id: cbId,
            reason: `Remote upload failed: ${error?.message || error}`,
          });
          continue;
        }

        // MCQ options presence (text or image)
        if (questionType === 0) {
          const optionPairs = [
            { text: toNullable(rawQuestion.op1), image: images.option1 },
            { text: toNullable(rawQuestion.op2), image: images.option2 },
            { text: toNullable(rawQuestion.op3), image: images.option3 },
            { text: toNullable(rawQuestion.op4), image: images.option4 },
          ];
          if (optionPairs.some((pair) => pair.text == null && !pair.image)) {
            validationErrors.push({ cb_id: cbId, reason: "MCQ options require text or image" });
            continue;
          }
        }

        // ====== Meta-only taxonomy (DO NOT read from row) ======
        const selectedYearId = context.selectedYearId;
        const selectedSubjectId = context.selectedSubjectId;
        const selectedChapterId = context.selectedChapterId;
        const selectedTopicId = context.selectedTopicId;

        if (!selectedYearId || !selectedSubjectId || !selectedChapterId || !selectedTopicId) {
          validationErrors.push({
            cb_id: cbId,
            reason: "Missing required year/subject/chapter/topic metadata from meta",
          });
          continue;
        }

        // (Optional) Belt-and-suspenders: nuke conflicting row fields in case of accidental spreads
        // delete rawQuestion.year;
        // delete rawQuestion.ncert_id;
        // delete rawQuestion.stNcert;
        // delete rawQuestion.selectedYearId;
        // delete rawQuestion.subject_id;
        // delete rawQuestion.chapter_id;
        // delete rawQuestion.topic_id;

        const payloadForInsert = {
          selectedChapterId,
          selectedSubjectId,
          selectedYearId,
          selectedTopicId,
          pre_question_text: toNullable(rawQuestion.question),
          option1_text: questionType === 0 ? toNullable(rawQuestion.op1) : null,
          option2_text: questionType === 0 ? toNullable(rawQuestion.op2) : null,
          option3_text: questionType === 0 ? toNullable(rawQuestion.op3) : null,
          option4_text: questionType === 0 ? toNullable(rawQuestion.op4) : null,
          correct_option: correctOption,
          pre_explanation_text: toNullable(rawQuestion.explanation),
          question_image_url: images.question,
          option1_image_url: images.option1,
          option2_image_url: images.option2,
          option3_image_url: images.option3,
          option4_image_url: images.option4,
          explanation_image_url: images.explanation,
          question_type: questionType,
          verified_status: "not_verified",
          difficulty_level: difficultyLevel,
          previousPapers: previousPapers ? JSON.stringify(previousPapers) : null,
        };

        // Debug the final IDs you're inserting with
        console.debug("INSERT question IDs", {
          cbId,
          selectedYearId,
          selectedSubjectId,
          selectedChapterId,
          selectedTopicId,
        });

        const newQuestionId = await insertQuestion(executeQuery, payloadForInsert);
        await insertMapping(executeQuery, cbId, newQuestionId);

        inserted.push({ cb_id: cbId, new_question_id: newQuestionId });
      } catch (error) {
        validationErrors.push({
          cb_id: rawQuestion?.id ?? null,
          reason: error.message || String(error),
        });
      }
    }

    return res.json({
      status: "ok",
      summary: {
        inserted: inserted.length,
        duplicates: duplicates.length,
        skipped_due_to_missing_images: skippedMissingImages.length,
        errors: validationErrors.length,
      },
      inserted,
      duplicates,
      skipped_due_to_missing_images: skippedMissingImages,
      errors: validationErrors,
      cb_folder_dir: folderDir,
      request_context: context,
    });
  });
};
