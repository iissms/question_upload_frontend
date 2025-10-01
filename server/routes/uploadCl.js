"use strict";

const fs = require("fs");
const path = require("path");

const LETTER_BY_INDEX = {
  "1": "A",
  "2": "B",
  "3": "C",
  "4": "D",
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

function resolveYearId(question) {
  if (question == null || typeof question !== "object") return null;
  if (question.stNcert != null) return question.stNcert;
  if (question.ncert_id != null) return question.ncert_id;
  if (question.year != null) return question.year;
  return null;
}

function pickCorrectOption(questionType, answer) {
  const normalized = toNullable(answer);
  if (normalized == null) return null;
  if (questionType === 0) {
    const letter = LETTER_BY_INDEX[String(normalized)] || null;
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
      verified_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    : path.resolve(__dirname, "..", "cb_folder");

  app.post("/upload/cl", async (req, res) => {
    const { payload, meta } = normalizeRequestBody(req.body);
    if (!payload || payload.length === 0) {
      return res
        .status(400)
        .json({ error: "Request must include a non-empty payload array" });
    }

    const context = {
      mode: toNullable(meta.mode ?? meta.type ?? null),
      selectedYearId: parseId(meta.yearId ?? meta.year_id ?? meta.selectedYearId),
      selectedSubjectId: parseId(meta.subjectId ?? meta.subject_id ?? meta.selectedSubjectId),
      selectedChapterId: parseId(meta.chapterId ?? meta.chapter_id ?? meta.selectedChapterId),
      selectedTopicId: parseId(meta.topicId ?? meta.topic_id ?? meta.selectedTopicId),
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

        const questionType = computeQuestionType(rawQuestion.qtype_id);
        const correctOption = pickCorrectOption(questionType, rawQuestion.answer);

        if (questionType === 0 && !correctOption) {
          validationErrors.push({ cb_id: cbId, reason: "Invalid correct option for MCQ" });
          continue;
        }

        if (questionType === 1 && (!correctOption || correctOption.trim().length === 0)) {
          validationErrors.push({ cb_id: cbId, reason: "Numeric question requires an answer" });
          continue;
        }

        const images = extractImageNames(rawQuestion);
        const missing = [];
        for (const [bucket, fileName] of Object.entries(images)) {
          if (!fileName) continue;
          const fullPath = path.join(folderDir, fileName);
          if (!fs.existsSync(fullPath)) {
            missing.push({ bucket, file: fileName });
          }
        }

        if (missing.length > 0) {
          skippedMissingImages.push({ cb_id: cbId, missing_images: missing });
          continue;
        }

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

        const payloadForInsert = {
          selectedChapterId:
            rawQuestion.chapter_id ?? context.selectedChapterId ?? null,
          selectedSubjectId:
            rawQuestion.subject_id ?? context.selectedSubjectId ?? null,
          selectedYearId: resolveYearId(rawQuestion) ?? context.selectedYearId ?? null,
          selectedTopicId:
            rawQuestion.topic_id ?? context.selectedTopicId ?? null,
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
        };

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
