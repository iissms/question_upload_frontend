const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors()); // Enable CORS
const foldername = "uploadquestion"; 
const failedQuestionsFile = path.join(__dirname, "failed_questions.json");
const { createWriteStream, existsSync, mkdirSync } = require("fs");
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));


// Ensure uploadquestion folder exists
const uploadDir = "./uploadquestion";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Database connection
const db = mysql.createPool({
   host: "194.238.23.60", // Database host
  user: "lohith_pc", // Database username
  password: "lohith_pc", // Database password
  database: "examtech", // Database name
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Utility function for MySQL queries
const executeQuery = (query, values) => {
  return new Promise((resolve, reject) => {
    db.query(query, values, (error, results) => {
      if (error) reject(error);
      else resolve(results);
    });
  });
};

// Configure file upload settings using `uploadquestion` folder
const storage = multer.diskStorage({
  destination: uploadDir, // Save files in `uploadquestion`
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Unique filename
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === ".json") {
      cb(null, true);
    } else {
      cb(new Error("Only .json files are allowed!"), false);
    }
  },
});

// ✅ Upload API
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded or invalid format" });
  }

  console.log("Uploaded file:", req.file.filename);
  console.log("Metadata:", req.body); // Captures year_id, subject_id, chapter_id, topic_id

  res.json({
    message: "File uploaded successfully",
    file: req.file.filename,
    metadata: req.body,
  });
});

// ✅ Get Years
app.get("/years", async (req, res) => {
  try {
    const results = await executeQuery("SELECT * FROM years");
    res.json(results);
  } catch (error) {
    console.error("Error fetching years:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Get Subjects (Based on Year)
app.get("/subjects", async (req, res) => {
  const { yearId } = req.query;
  if (!yearId) return res.status(400).json({ error: "Year ID is required" });

  try {
    const query = `
      SELECT DISTINCT s.* 
      FROM subjects s
      JOIN chapters c ON s.subject_id = c.subject_id
      WHERE c.year_id = ?;
    `;
    const results = await executeQuery(query, [yearId]);
    res.json(results);
  } catch (error) {
    console.error("Error fetching subjects:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Get Chapters (Based on Subject)
app.get("/chapters", async (req, res) => {
  const { subjectId } = req.query;
  if (!subjectId) return res.status(400).json({ error: "Subject ID is required" });

  try {
    const results = await executeQuery("SELECT * FROM chapters WHERE subject_id = ?", [subjectId]);
    res.json(results);
  } catch (error) {
    console.error("Error fetching chapters:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Get Topics (Based on Chapter)
app.get("/topics", async (req, res) => {
  const { chapterId } = req.query;
  if (!chapterId) return res.status(400).json({ error: "Chapter ID is required" });

  try {
    const results = await executeQuery("SELECT * FROM topics WHERE chapter_id = ?", [chapterId]);
    res.json(results);
  } catch (error) {
    console.error("Error fetching topics:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

let selectedChapterId_id = 12;
let selectedYearId_id = 9;
let selectedSubjectId_id = 14;
let selectedTopicId_id = 12;

// Route to display all questions from JSON files in the "PHYSICS" folder
app.post("/upload-questions", async (req, res) => {
    const { year_id, subject_id, chapter_id, topic_id } = req.body;
    selectedChapterId_id = chapter_id;
selectedYearId_id = year_id;
selectedSubjectId_id = subject_id;
selectedTopicId_id = topic_id;
  const directoryPath = path.join(__dirname, foldername);
  const allQuestions = [];
  const failedQuestions = [];
      let duplicateCount = 0; // Track duplicate questions


  try {
    const files = fs.readdirSync(directoryPath).filter((file) => file.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      let jsonData;

      try {
        const fileData = fs.readFileSync(filePath, "utf8");
        jsonData = JSON.parse(fileData);
      } catch (error) {
        console.error(`Error reading/parsing file ${file}:`, error.message);
        failedQuestions.push({ file, error: "Invalid JSON format or structure issue" });
        continue; // Move to next file
      }

      for (const item of jsonData) {
        if (item.questions) {
          for (const question of item.questions) {
            try {
              // Check if question already exists in `question_id_mapping`
                            const exists = await checkQuestionExists(question.id);
                            if (exists) {
                                console.log(`Skipping duplicate question ID: ${question.id}`);
                                duplicateCount++; // Increase duplicate count

                                continue;
                            }
              const formattedPreviousPapers = formatPreviousPapers(question.tags?.previousPapers || []);

              allQuestions.push({
                id: question.id,
                question_text: question.question_text,
                option_1: question.option_1,
                option_2: question.option_2,
                option_3: question.option_3,
                option_4: question.option_4,
                solution_text: question.solution_text,
                question_image_url: question.supporting_picture,
                option1_image_url: question.image_option_1,
                option2_image_url: question.image_option_2,
                option3_image_url: question.image_option_3,
                option4_image_url: question.image_option_4,
                difficulty_level: question.complexity,
                correct_option: question.answers[0],
                explanation_image_url: question.solution_supporting_picture,
                question_type: question.question_type,
                previousPapers: formattedPreviousPapers,
              });
            } catch (error) {
              console.error(`Error processing question in file ${file}:`, error.message);
              failedQuestions.push({ file, question, error: error.message });
              continue; // Move to next question
            }
          }
        }
      }
    }

    // Insert valid questions into the database
    let uploadedCount = 0;
    if (allQuestions.length > 0) {
      await new Promise((resolve) => {
        insertAllQuestions(allQuestions, (err) => {
          if (err) {
            console.error("Error inserting questions:", err.message);
          } else {
            uploadedCount = allQuestions.length;
          }
          resolve();
        });
      });
    }

    // Append failed questions if any
    if (failedQuestions.length > 0) {
      appendFailedQuestions(failedQuestions);
    }

    // Empty the upload folder after processing all files
    emptyUploadFolder(directoryPath);

    const responseMessage = `Upload Complete: ${uploadedCount} questions uploaded, ${duplicateCount} duplicates skipped, ${failedQuestions.length} failed.`;
    console.log(responseMessage);
        res.json(responseMessage);

  } catch (error) {
    console.error("Unexpected error:", error.message);
    res.status(500).send("An unexpected error occurred.");
  }
});

async function checkQuestionExists(questionId) {
    return new Promise((resolve, reject) => {
        db.query("SELECT COUNT(*) AS count FROM question_id_mapping WHERE old_question_id = ?", [questionId], (err, results) => {
            if (err) {
                console.error(`Error checking question existence for ID ${questionId}:`, err.message);
                reject(err);
            } else {
                resolve(results[0].count > 0); // If count > 0, the question exists
            }
        });
    });
}

async function checkQuestionExistsByTgId(tgId) {
  if (!tgId) return false;
  const results = await executeQuery(
    "SELECT COUNT(*) AS count FROM question_id_mapping WHERE tg_id = ?",
    [tgId]
  );
  const row = Array.isArray(results) ? results[0] : results;
  return Boolean(row?.count);
}

function imageExistsInTgFolder(filename) {
  if (!filename) return true;
  try {
    fs.accessSync(path.join(TG_FOLDER_DIR, filename));
    return true;
  } catch (err) {
    return false;
  }
}

// Function to empty the upload folder
function emptyUploadFolder(directoryPath) {
  try {
    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      fs.unlinkSync(filePath); // Delete each file
    }

    console.log("Upload folder emptied successfully.");
  } catch (error) {
    console.error("Error emptying upload folder:", error.message);
  }
}

// Function to append failed questions to failed_questions.json
function appendFailedQuestions(failedQuestions) {
  fs.readFile(failedQuestionsFile, "utf8", (err, data) => {
    let existingData = [];

    if (!err && data) {
      try {
        existingData = JSON.parse(data);
      } catch (parseError) {
        console.error("Error parsing existing failed_questions.json:", parseError.message);
      }
    }

    const updatedData = [...existingData, ...failedQuestions];

    fs.writeFile(failedQuestionsFile, JSON.stringify(updatedData, null, 2), (writeErr) => {
      if (writeErr) {
        console.error("Error writing to failed_questions.json:", writeErr.message);
      } else {
        console.log("Failed questions appended to failed_questions.json.");
      }
    });
  });
}

// 📥 Insert All Questions
function insertAllQuestions(questions, callback) {
  const filteredQuestions = questions.filter((q) => q.question_type !== 2);

  if (filteredQuestions.length === 0) {
    console.log("No valid questions to insert.");
    return callback(null);
  }

  const insertPromises = filteredQuestions.map((question) => {
    return new Promise((resolve, reject) => {
      insertQuestion(question, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });

  Promise.all(insertPromises)
    .then(() => {
      console.log("All valid questions inserted successfully");
      callback(null);
    })
    .catch((err) => {
      console.error("Error inserting some questions:", err.message);
      callback(err);
    });
}

// 🛠️ Convert previousPapers format (e.g., '20' → '2020')
function formatPreviousPapers(previousPapers) {
  return previousPapers.map((paper) => {
    const match = paper.match(/(\d{2})$/); // Match last 2-digit year
    if (match) {
      const lastTwoDigits = parseInt(match[1], 10);
      if (lastTwoDigits >= 10 && lastTwoDigits <= 30) {
        const fullYear = 2000 + lastTwoDigits;
        return {
          paper_name: paper.replace(/'\d{2}$/, "").trim(),
          year: fullYear,
        };
      }
    }
    return { paper_name: paper, year: null }; // If no year, keep year as null
  });
}

async function insertQuestion(question, callback) {
  try {
    // Existing mapping code for difficulty level
    let mappedDifficulty;
    if (question.difficulty_level === 1 || question.difficulty_level === 2) {
      mappedDifficulty = "low";
    } else if (question.difficulty_level === 3) {
      mappedDifficulty = "medium";
    } else if (
      question.difficulty_level === 4 ||
      question.difficulty_level === 5
    ) {
      mappedDifficulty = "high";
    } else {
      mappedDifficulty = null;
    }

    // Existing mapping code for correct option
    let mappedCorrectOption;
    if (question.question_type === 0) {
      const optionMapping = { 1: "A", 2: "B", 3: "C", 4: "D" };
      mappedCorrectOption =
        optionMapping[question.correct_option] || question.correct_option;
    } else {
      mappedCorrectOption = question.correct_option;
    }

    // 🎯 Fetch previous exam IDs from `previous_year_exams`
    const previousExamIds = await getPreviousExamIds(question.previousPapers);
    const previousExamIdsJson =
      previousExamIds.length > 0 ? JSON.stringify(previousExamIds) : null;

    const query = `
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
        difficulty_level,
        explanation_image_url,
        question_type,
        previousPapers
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      selectedChapterId_id, // selectedChapterId
      selectedSubjectId_id, // selectedSubjectId
      selectedYearId_id, // selectedYearId
      selectedTopicId_id, // selectedTopicId
      question.question_text,
      question.option_1,
      question.option_2,
      question.option_3,
      question.option_4,
      mappedCorrectOption,
      question.solution_text,
      question.question_image_url,
      question.option1_image_url,
      question.option2_image_url,
      question.option3_image_url,
      question.option4_image_url,
      mappedDifficulty,
      question.explanation_image_url,
      question.question_type,
      previousExamIdsJson, // Store IDs in previousPapers column
    ];

    db.query(query, values, async (err, results) => {
      if (err) {
        console.error("Error inserting question:", err.message);
        return callback(err);
      }

      const newQuestionId = results.insertId;
      console.log("Inserted question ID:", newQuestionId);

      // Add entry to question_id_mapping table
      if (question.id) {
        const mappingQuery = `
          INSERT INTO question_id_mapping (
            old_question_id,
            new_question_id
          ) VALUES (?, ?)
        `;

        db.query(mappingQuery, [question.id, newQuestionId], (mappingErr) => {
          if (mappingErr) {
            console.error(
              "Error inserting question ID mapping:",
              mappingErr.message
            );
            // Continue with the process even if mapping fails
          } else {
            console.log(
              `Mapped old ID ${question.id} to new ID ${newQuestionId}`
            );
          }

          // Continue with image processing
          processImagesAndFinish();
        });
      } else {
        // No old ID to map, continue with image processing
        processImagesAndFinish();
      }

      // Helper function to process images and finish
      function processImagesAndFinish() {
        // Check if question has any images and process them
        const hasImages =
          question.question_image_url ||
          question.option1_image_url ||
          question.option2_image_url ||
          question.option3_image_url ||
          question.option4_image_url ||
          question.explanation_image_url;

        if (hasImages) {
          console.log("It has images", question.id, newQuestionId);
          try {
            processQuestionImages(question, newQuestionId)
              .then(() => callback(null))
              .catch((imageError) => {
                console.error("Error processing images:", imageError);
                callback(null); // Continue even if image processing fails
              });
          } catch (imageError) {
            console.error("Error processing images:", imageError);
            callback(null); // Continue even if image processing fails
          }
        } else {
          callback(null);
        }
      }
    });
  } catch (error) {
    console.error("Error processing question:", error);
    callback(error);
  }
}
// 📥 Insert All Questions
function insertAllQuestions(questions, callback) {
  const filteredQuestions = questions.filter((q) => q.question_type !== 2);

  if (filteredQuestions.length === 0) {
    console.log("No valid questions to insert.");
    return callback(null);
  }

  const insertPromises = filteredQuestions.map((question) => {
    return new Promise((resolve, reject) => {
      insertQuestion(question, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });

  Promise.all(insertPromises)
    .then(() => {
      console.log("All valid questions inserted successfully");
      callback(null);
    })
    .catch((err) => {
      console.error("Error inserting some questions:", err.message);
      callback(err);
    });
}

// 🔍 Fetch IDs from `previous_year_exams` based on `paper_name` and `year`
async function getPreviousExamIds(previousPapers) {
  if (!previousPapers || previousPapers.length === 0) return [];

  return new Promise((resolve, reject) => {
    const conditions = previousPapers
      .map((paper) =>
        paper.year ? "(paper_name = ? AND year = ?)" : "(paper_name = ?)"
      )
      .join(" OR ");

    const values = previousPapers.flatMap((paper) =>
      paper.year ? [paper.paper_name, paper.year] : [paper.paper_name]
    );

    const query = `SELECT id FROM previous_year_exams WHERE ${conditions}`;

    db.query(query, values, (err, results) => {
      if (err) {
        console.error("Error fetching previous exam IDs:", err.message);
        reject(err);
      } else {
        resolve(results.map((row) => row.id)); // Extract only the IDs
      }
    });
  });
}

// Add this function to handle image processing during question upload
async function processQuestionImages(question, newQuestionId) {
  // Define the image types to look for
  const imageTypes = {
    'question_image_url': 'supporting_picture',
    'option1_image_url': 'image_option_1',
    'option2_image_url': 'image_option_2',
    'option3_image_url': 'image_option_3',
    'option4_image_url': 'image_option_4',
    'explanation_image_url': 'solution_supporting_picture'
  };
  
  // Source images folder path
  const sourceImagesDir = path.join(__dirname, "images");
  
  // Create destination folder if it doesn't exist
  const destImagesDir = path.join(__dirname, "new_images");
  if (!existsSync(destImagesDir)) {
    mkdirSync(destImagesDir, { recursive: true });
  }
  
  // Process each image type
  for (const [dbField, imageType] of Object.entries(imageTypes)) {
    // Skip if this question doesn't have this type of image
    if (!question[dbField]) continue;
    
    // Original image filename format: ID_image_type.png
    const originalId = question.id;
    const sourceFilename = `${originalId}_${imageType}.png`;
    console.log(`Processing image: ${sourceFilename}`);
    const sourcePath = path.join(sourceImagesDir, sourceFilename);
    
    // New image filename format with new question ID
    const destFilename = `${newQuestionId}_${imageType}.png`;
    console.log(`New image filename: ${destFilename}`);
    const destPath = path.join(destImagesDir, destFilename);
    
    console.log(`Source path: ${sourcePath}`);
    // Check if source image exists and copy it
    if (existsSync(sourcePath)) {
      try {
        // Copy the file
        fs.copyFileSync(sourcePath, destPath);
        console.log(`Copied image: ${sourceFilename} → ${destFilename}`);
      } catch (error) {
        console.error(`Error copying image ${sourceFilename}:`, error.message);
      }
    } else {
      console.warn(`Image not found: ${sourceFilename}`);
    }
  }
}

const fsp = fs.promises;


// ---- folder where source images live ----
const TG_FOLDER_DIR = process.env.TG_FOLDER_DIR
  ? path.resolve(process.env.TG_FOLDER_DIR)
  : path.resolve(__dirname, "tg_folder");
console.log(`[upload/id] Using TG_FOLDER_DIR: ${TG_FOLDER_DIR}`);

// ---- helpers (html/img parsing etc.) ----
const IMG_HTML_RE = /<img[^>]*\s+src=["']([^"']+)["'][^>]*>/gi;
const IMG_MD_RE   = /!\[[^\]]*\]\(([^)]+)\)/g;

function unescapeHtmlEntities(s = "") {
  return String(s)
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
function countImgsInText(text) {
  if (typeof text !== "string") return 0;
  const un = unescapeHtmlEntities(text);
  const htmlHits = [...un.matchAll(IMG_HTML_RE)].length;
  const mdHits   = [...un.matchAll(IMG_MD_RE)].length;
  return htmlHits + mdHits;
}
function extractAndRemoveImages(text) {
  if (!text || typeof text !== "string") return { text: "", images: [] };
  let s = unescapeHtmlEntities(text);
  const urls = [];
  s = s.replace(IMG_HTML_RE, (_m, src) => (urls.push(src), ""));
  s = s.replace(IMG_MD_RE,   (_m, url) => (urls.push(url), ""));
  return { text: s.trim(), images: urls };
}
function stripHtmlKeepText(s = "") {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function isNoneOfTheAbove(text = "") {
  const t = stripHtmlKeepText(text).toLowerCase();
  return (
    t === "none of the above" ||
    t === "none of these" ||
    t === "none of the given options" ||
    t === "none of the options" ||
    t === "none"
  );
}
function indexToLetter(idx) {
  return ["A", "B", "C", "D"][idx] || null; // uppercase
}
function hasContent(text, imageName) {
  return stripHtmlKeepText(text || "").length > 0 || !!(imageName && String(imageName).trim());
}
function mapQuestionType(type) {
  const t = String(type || "").trim().toLowerCase();
  if (t === "mcq") return 0;
  if (t === "numeric" || t === "number" || t === "integer") return 1;
  return null;
}
function buildPlaceholders(rowCount, colsPerRow) {
  const one = `(${Array(colsPerRow).fill("?").join(", ")})`;
  return Array(rowCount).fill(one).join(", ");
}
function countQuestionBucketOriginal(q) {
  let total = countImgsInText(q?.question || "");
  const qi = q?.question_images;
  if (Array.isArray(qi)) total += qi.filter(x => typeof x === "string" && x.trim()).length;
  return total;
}
function countSolutionBucketOriginal(q) {
  let total = countImgsInText(q?.solution || "");
  const si = q?.solution_images;
  if (Array.isArray(si)) total += si.filter(x => typeof x === "string" && x.trim()).length;
  return total;
}
function countOptionsBucketOriginal(q) {
  const names = ["option1", "option2", "option3", "option4"];
  let maxInOne = 0;
  for (const name of names) {
    let c = countImgsInText(q?.[name] || "");
    const single = q?.[`${name}_image`];
    if (typeof single === "string" && single.trim()) c += 1;
    const many = q?.[`${name}_images`];
    if (Array.isArray(many)) c += many.filter(x => typeof x === "string" && x.trim()).length;
    maxInOne = Math.max(maxInOne, c);
  }
  return maxInOne;
}

// ---- image naming / path helpers ----
function basenameFromAny(maybeUrl) {
  if (!maybeUrl || typeof maybeUrl !== "string") return null;
  let s = String(maybeUrl).trim();
  const qIdx = s.indexOf("?"); if (qIdx !== -1) s = s.slice(0, qIdx);
  const hIdx = s.indexOf("#"); if (hIdx !== -1) s = s.slice(0, hIdx);
  try { s = decodeURIComponent(s); } catch {}
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return path.posix.basename(u.pathname);
    } catch { /* fallthrough */ }
  }
  const parts = s.split(/[\/\\]+/).filter(Boolean);
  return parts.pop() || null;
}
function buildDstName(newId, kind, optIndex, srcName) {
  const ext = (srcName && path.extname(srcName)) || ".png";
  if (kind === "q") return `${newId}_supporting_picture${ext}`;
  if (kind === "s") return `${newId}_solution_supporting_picture${ext}`;
  return `${newId}_image_option_${optIndex}${ext}`;
}

/**
 * Try to move file from tg_folder to new filename.
 * Returns { name: <finalFileName>, found: boolean }.
 * If source missing, logs warn and returns found=false but still returns the target name
 * (so DB gets the expected filename).
 * NOTE: pushes to `missingSourceCollector` ONLY when the URL existed but file not found.
 */
async function tryRenameFromTgFolder(srcName, dstName, tgId, newId, bucket, missingSourceCollector) {
  if (!srcName) return { name: null, found: false };
  const src = path.join(TG_FOLDER_DIR, srcName);
  const dst = path.join(TG_FOLDER_DIR, dstName);
  try {
    await fsp.access(src);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    try {
      await fsp.rename(src, dst);
    } catch (e) {
      if (e && e.code === "EXDEV") {
        await fsp.copyFile(src, dst);
        await fsp.unlink(src);
      } else {
        throw e;
      }
    }
    return { name: dstName, found: true };
  } catch (e) {
    console.warn(`[upload/id] Source image not found; keeping name only: ${srcName} -> ${dstName}`);
    if (Array.isArray(missingSourceCollector)) {
      missingSourceCollector.push({
        tg_id: tgId,
        new_id: newId,
        bucket,
        src: srcName,
        expected: dstName
      });
    }
    return { name: dstName, found: false };
  }
}

// ========== routes ==========

// sample existing route
app.get("/years", async (req, res) => {
  try {
    const results = await executeQuery("SELECT * FROM years");
    res.json(results);
  } catch (error) {
    console.error("Error fetching years:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/upload/id", async (req, res) => {
  const TX_BEGIN = "START TRANSACTION";
  const TX_COMMIT = "COMMIT";
  const TX_ROLLBACK = "ROLLBACK";

  try {
    const { mode, yearId, subjectId, chapterId, topicId, payload } = req.body || {};
    if (mode !== "id") return res.status(400).json({ error: "Invalid mode: expected 'id'" });
    if (!Array.isArray(payload) || payload.length === 0)
      return res.status(400).json({ error: "payload must be a non-empty array" });

    const errors = [];
    const skipped = [];
    const alreadyUploaded = [];
    const skippedMissingImages = [];
    const duplicateInPayload = [];
    const rows = [];                 // first insert (image cols NULL), update later
    const tgIdsInOrder = [];
    const oldIntIdsInOrder = [];
    const renamePlan = [];           // per-question sources {q,o1,o2,o3,o4,s}
    const seenTgIds = new Set();

    // ---- normalize / validate / skip ----
    for (const pack of payload) {
      const questions = Array.isArray(pack?.data?.questions) ? pack.data.questions : [];
      for (const q of questions) {
        const tgId = String(q?.key ?? "").trim();
        if (!tgId) {
          errors.push({ key: q.key, reason: "Missing tg_id/key for duplicate check." });
          continue;
        }

        if (seenTgIds.has(tgId)) {
          duplicateInPayload.push({ key: q.key, tg_id: tgId, reason: "Duplicate tg_id in payload" });
          continue;
        }

        const existsByTgId = await checkQuestionExistsByTgId(tgId);
        if (existsByTgId) {
          alreadyUploaded.push({ key: q.key, tg_id: tgId, reason: "Question already uploaded" });
          continue;
        }

        const qTypeCode = mapQuestionType(q.question_type);
        if (qTypeCode === null) {
          errors.push({ key: q.key, reason: `Invalid question_type '${q.question_type}'. Expected 'mcq' or 'numeric'.` });
          continue;
        }

        const qImgs = countQuestionBucketOriginal(q);
        const sImgs = countSolutionBucketOriginal(q);
        const oImgs = countOptionsBucketOriginal(q);
        if (qImgs >= 2 || sImgs >= 2 || oImgs >= 2) {
          skipped.push({
            key: q.key,
            reason: ">=2 images in bucket",
            buckets: { question_imgs: qImgs, options_max_in_one: oImgs, solution_imgs: sImgs }
          });
          continue;
        }

        const answers = Array.isArray(q.answer) ? q.answer : [];
        if (answers.length > 1) { errors.push({ key: q.key, reason: "Multiple answers not allowed", answers }); continue; }
        if (answers.length === 0) { errors.push({ key: q.key, reason: "Missing answer" }); continue; }

        const { text: cleanQuestion, images: qImgsFound } = extractAndRemoveImages(q.question);
        const { text: cleanSolution, images: sImgsFound } = extractAndRemoveImages(q.solution);
        const opt1 = extractAndRemoveImages(q.option1);
        const opt2 = extractAndRemoveImages(q.option2);
        const opt3 = extractAndRemoveImages(q.option3);
        const opt4 = extractAndRemoveImages(q.option4);

        const qSrc  = basenameFromAny((qImgsFound[0] || (Array.isArray(q.question_images) ? q.question_images[0] : null)) || null);
        const sSrc  = basenameFromAny((sImgsFound[0] || (Array.isArray(q.solution_images) ? q.solution_images[0] : null)) || null);
        const o1Src = basenameFromAny((opt1.images[0] || q.option1_image || (Array.isArray(q.option1_images) ? q.option1_images[0] : null)) || null);
        const o2Src = basenameFromAny((opt2.images[0] || q.option2_image || (Array.isArray(q.option2_images) ? q.option2_images[0] : null)) || null);
        const o3Src = basenameFromAny((opt3.images[0] || q.option3_image || (Array.isArray(q.option3_images) ? q.option3_images[0] : null)) || null);
        const o4Src = basenameFromAny((opt4.images[0] || q.option4_image || (Array.isArray(q.option4_images) ? q.option4_images[0] : null)) || null);

        const missingSources = [];
        const sourcesToCheck = [
          { bucket: "question", src: qSrc },
          { bucket: "option1", src: o1Src },
          { bucket: "option2", src: o2Src },
          { bucket: "option3", src: o3Src },
          { bucket: "option4", src: o4Src },
          { bucket: "solution", src: sSrc },
        ];

        for (const item of sourcesToCheck) {
          if (item.src && !imageExistsInTgFolder(item.src)) {
            missingSources.push({ bucket: item.bucket, src: item.src });
          }
        }

        if (missingSources.length > 0) {
          skippedMissingImages.push({ key: q.key, tg_id: tgId, missing_images: missingSources });
          continue;
        }

        if (!hasContent(cleanQuestion, qSrc)) {
          errors.push({ key: q.key, reason: "Question missing (no text and no image)" });
          continue;
        }
        if (qTypeCode === 0) {
          const optionHasContent = [
            hasContent(opt1.text, o1Src),
            hasContent(opt2.text, o2Src),
            hasContent(opt3.text, o3Src),
            hasContent(opt4.text, o4Src),
          ];
          if (optionHasContent.includes(false)) {
            errors.push({ key: q.key, reason: "MCQ requires all four options to have text or image." });
            continue;
          }
        }

        // resolve answer
        let answerOut = null;
        const idx = Number(answers[0]) - 1;
        if (qTypeCode === 0) {
          if (Number.isInteger(idx) && idx >= 0 && idx <= 3) {
            const optsClean = [opt1.text, opt2.text, opt3.text, opt4.text];
            answerOut = isNoneOfTheAbove(optsClean[idx])
              ? stripHtmlKeepText(optsClean[idx]) || "None of the above"
              : indexToLetter(idx);
          } else {
            errors.push({ key: q.key, reason: "MCQ answer must point to option 1..4" });
            continue;
          }
        } else {
          answerOut = stripHtmlKeepText(answers[0]);
          if (!answerOut) { errors.push({ key: q.key, reason: "Numeric question requires a numeric/text answer" }); continue; }
        }

        // terminal preview
        console.log(JSON.stringify({
          key: q.key,
          question_type: qTypeCode,
          verified_status: "not_verified",
          question: cleanQuestion,
          question_image: qSrc || null,
          option_1: opt1.text,
          option_2: opt2.text,
          option_3: opt3.text,
          option_4: opt4.text,
          option1_image: o1Src || null,
          option2_image: o2Src || null,
          option3_image: o3Src || null,
          option4_image: o4Src || null,
          answer: answerOut,
          solution: cleanSolution,
          solution_image: sSrc || null
        }, null, 2));

        seenTgIds.add(tgId);

        // first insert (images null)
        rows.push([
          chapterId ?? null,
          subjectId ?? null,
          yearId ?? null,
          topicId ?? null,
          cleanQuestion || null,
          opt1.text || null,
          opt2.text || null,
          opt3.text || null,
          opt4.text || null,
          answerOut || null,
          cleanSolution || null,
          null, null, null, null, null, null, // image columns
          qTypeCode,
          "not_verified"
        ]);

        // remember sources for rename
        renamePlan.push({ q: qSrc, o1: o1Src, o2: o2Src, o3: o3Src, o4: o4Src, s: sSrc });

        tgIdsInOrder.push(tgId);
        oldIntIdsInOrder.push(/^\d+$/.test(tgId) ? Number(tgId) : null);
      }
    }

    // abort on validation errors
    if (errors.length > 0) {
      return res.status(400).json({
        status: "error",
        message: "Validation failed. Nothing was uploaded.",
        errors,
        skipped_due_to_images: skipped,
        already_uploaded: alreadyUploaded,
        skipped_due_to_missing_images: skippedMissingImages,
        duplicate_in_payload: duplicateInPayload
      });
    }

    if (rows.length === 0) {
      return res.json({
        status: "ok",
        message: "No questions to insert (all skipped due to ≥2 images or none provided).",
        stats: {
          inserted: 0,
          skipped: skipped.length,
          already_uploaded: alreadyUploaded.length,
          skipped_due_to_missing_images: skippedMissingImages.length,
          duplicate_in_payload: duplicateInPayload.length
        },
        skipped_due_to_images: skipped,
        already_uploaded: alreadyUploaded,
        skipped_due_to_missing_images: skippedMissingImages,
        duplicate_in_payload: duplicateInPayload
      });
    }

    // ---- transaction: insert -> mapping -> rename -> update ----
    await executeQuery(TX_BEGIN);

    const placeholders = buildPlaceholders(rows.length, 19);
    const SQL_INSERT_QUESTIONS = `
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
      ) VALUES ${placeholders}
    `;
    const insertRes = await executeQuery(SQL_INSERT_QUESTIONS, rows.flat());

    let baseId =
      (Array.isArray(insertRes) ? insertRes[0]?.insertId : insertRes?.insertId) ?? null;
    if (!baseId) {
      const lastIdRes = await executeQuery("SELECT LAST_INSERT_ID() AS firstId");
      const row0 = Array.isArray(lastIdRes) ? lastIdRes[0] : lastIdRes;
      baseId = row0?.firstId || row0?.[0]?.firstId || null;
    }
    if (!baseId) {
      await executeQuery(TX_ROLLBACK);
      return res.status(500).json({
        status: "error",
        message: "Could not determine inserted question IDs; transaction reverted."
      });
    }

    const newIds = tgIdsInOrder.map((_, i) => baseId + i);

    const mappingRows = newIds.map((newId, i) => [
      oldIntIdsInOrder[i],
      newId,
      tgIdsInOrder[i]
    ]);
    const mappingPlaceholders = buildPlaceholders(mappingRows.length, 3);
    const SQL_INSERT_MAPPING = `
      INSERT INTO question_id_mapping (
        old_question_id,
        new_question_id,
        tg_id
      ) VALUES ${mappingPlaceholders}
    `;
    await executeQuery(SQL_INSERT_MAPPING, mappingRows.flat());

    // collect ONLY "URL present but file missing" details
    const missingSourceImages = [];

    // rename + update per row
    for (let i = 0; i < newIds.length; i++) {
      const id = newIds[i];
      const plan = renamePlan[i];
      const tgId = tgIdsInOrder[i];

      const qDst  = plan.q  ? buildDstName(id, "q", null, plan.q)  : null;
      const o1Dst = plan.o1 ? buildDstName(id, "o", 1,    plan.o1) : null;
      const o2Dst = plan.o2 ? buildDstName(id, "o", 2,    plan.o2) : null;
      const o3Dst = plan.o3 ? buildDstName(id, "o", 3,    plan.o3) : null;
      const o4Dst = plan.o4 ? buildDstName(id, "o", 4,    plan.o4) : null;
      const sDst  = plan.s  ? buildDstName(id, "s", null, plan.s)  : null;

      const qFinal  = plan.q  ? await tryRenameFromTgFolder(plan.q,  qDst,  tgId, id, "question", missingSourceImages) : { name: null, found: false };
      const o1Final = plan.o1 ? await tryRenameFromTgFolder(plan.o1, o1Dst, tgId, id, "option1",  missingSourceImages) : { name: null, found: false };
      const o2Final = plan.o2 ? await tryRenameFromTgFolder(plan.o2, o2Dst, tgId, id, "option2",  missingSourceImages) : { name: null, found: false };
      const o3Final = plan.o3 ? await tryRenameFromTgFolder(plan.o3, o3Dst, tgId, id, "option3",  missingSourceImages) : { name: null, found: false };
      const o4Final = plan.o4 ? await tryRenameFromTgFolder(plan.o4, o4Dst, tgId, id, "option4",  missingSourceImages) : { name: null, found: false };
      const sFinal  = plan.s  ? await tryRenameFromTgFolder(plan.s,  sDst,  tgId, id, "solution", missingSourceImages) : { name: null, found: false };

      const updSql = `
        UPDATE questions SET
          question_image_url     = ?,
          option1_image_url      = ?,
          option2_image_url      = ?,
          option3_image_url      = ?,
          option4_image_url      = ?,
          explanation_image_url  = ?
        WHERE id = ?
      `;
      await executeQuery(updSql, [
        qFinal.name, o1Final.name, o2Final.name, o3Final.name, o4Final.name, sFinal.name, id
      ]);

      // terminal confirmation
      console.log(JSON.stringify({
        id,
        question_image: qFinal.name,
        option1_image: o1Final.name,
        option2_image: o2Final.name,
        option3_image: o3Final.name,
        option4_image: o4Final.name,
        solution_image: sFinal.name
      }, null, 2));
    }

    await executeQuery(TX_COMMIT);

    // Build the *requested* summary:
    // ONLY cases where an image link was present but source file missing in tg_folder.
    const byBucket = { question: 0, option1: 0, option2: 0, option3: 0, option4: 0, solution: 0 };
    for (const item of missingSourceImages) {
      if (byBucket[item.bucket] != null) byBucket[item.bucket]++;
    }

    return res.json({
      status: "ok",
      message: "Questions inserted, mapped, images renamed (filenames only), and updated. Skipped any with ≥2 images, duplicates, or missing source images.",
      stats: {
        inserted: rows.length,
        skipped_due_to_image_limits: skipped.length,
        already_uploaded: alreadyUploaded.length,
        skipped_due_to_missing_images: skippedMissingImages.length,
        duplicate_in_payload: duplicateInPayload.length
      },
      skipped_due_to_images: skipped,
      already_uploaded: alreadyUploaded,
      skipped_due_to_missing_images: skippedMissingImages,
      duplicate_in_payload: duplicateInPayload,
      id_map_preview: newIds.slice(0, 5).map((id, i) => ({ tg_id: tgIdsInOrder[i], new_id: id })),
      // >>> The only image-missing summary you asked for:
      missing_images_summary: {
        total_missing_source_files: missingSourceImages.length,
        by_bucket: byBucket,
        items: missingSourceImages // [{tg_id, new_id, bucket, src, expected}]
      }
    });
  } catch (err) {
    try { await executeQuery("ROLLBACK"); } catch (_) {}
    console.error("Error in /upload/id:", err);
    return res.status(500).json({
      status: "error",
      message: "Insert failed. All changes reverted. You can re-upload the JSON.",
      error: String(err?.message || err)
    });
  }
});

// Start Server
app.listen(3089, () => {
  console.log("Server running on port 3000");
});
