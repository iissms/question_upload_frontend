import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "";

const MODE_OPTIONS = [
  { value: "id", label: "ID" },
  { value: "cb", label: "CB" },
  { value: "tg", label: "TG" },
];

const MODE_ENDPOINTS = {
  id: "/upload/id",
  cb: "/upload/cb",
  tg: "/upload/tg",
};

const toDisplayString = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return `${value}`;
  return "";
};

const buildAlreadyUploadedSummary = (body, previewLimit = 5) => {
  const entries = Array.isArray(body?.already_uploaded) ? body.already_uploaded : [];
  if (entries.length === 0) return null;

  const idCandidates = entries
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") {
        return `${item}`;
      }
      if (item && typeof item === "object") {
        return toDisplayString(item.tg_id) || toDisplayString(item.key);
      }
      return "";
    })
    .filter((value) => value.length > 0);

  if (idCandidates.length === 0) {
    return `Already uploaded ${entries.length} question${entries.length === 1 ? "" : "s"}.`;
  }

  const shown = idCandidates.slice(0, previewLimit);
  const remaining = idCandidates.length - shown.length;
  const previewText = shown.join(", ");
  const suffix = remaining > 0 ? `, +${remaining} more` : "";

  return `Already uploaded ${entries.length} question${entries.length === 1 ? "" : "s"}: ${previewText}${suffix}.`;
};

const buildUploadErrorMessage = (status, body, fallback) => {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const baseMessage =
    (typeof body?.error === "string" && body.error.trim()) ||
    (typeof body?.message === "string" && body.message.trim()) ||
    fallback ||
    `Upload failed with status ${status}`;

  const alreadyUploadedSummary = buildAlreadyUploadedSummary(body);

  return [baseMessage, alreadyUploadedSummary].filter(Boolean).join(" ");
};

const buildUrl = (path, params) => {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    });
  }
  return url.toString().replace(window.location.origin, "");
};

const Dropdown = ({ id, label, placeholder, options, value, onChange, disabled }) => (
  <label className="dropdown" htmlFor={id}>
    <span>{label}</span>
    <select id={id} value={value} onChange={onChange} disabled={disabled}>
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

function App() {
  const [years, setYears] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [topics, setTopics] = useState([]);

  const [selectedYear, setSelectedYear] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedChapter, setSelectedChapter] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [selectionMode, setSelectionMode] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [uploadResponse, setUploadResponse] = useState(null);

  const fetchData = async (path, params) => {
    const url = buildUrl(path, params);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      setError(err.message || "Something went wrong");
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData("/years").then(setYears);
  }, []);

  const handleYearChange = async (event) => {
    const yearId = event.target.value;
    setSelectedYear(yearId);
    setSelectedSubject("");
    setSelectedChapter("");
    setSelectedTopic("");
    setChapters([]);
    setTopics([]);

    if (yearId) {
      const data = await fetchData("/subjects", { yearId });
      setSubjects(data);
    } else {
      setSubjects([]);
    }
  };

  const handleSubjectChange = async (event) => {
    const subjectId = event.target.value;
    setSelectedSubject(subjectId);
    setSelectedChapter("");
    setSelectedTopic("");
    setTopics([]);

    if (subjectId) {
      const data = await fetchData("/chapters", { subjectId });
      setChapters(data);
    } else {
      setChapters([]);
    }
  };

  const handleChapterChange = async (event) => {
    const chapterId = event.target.value;
    setSelectedChapter(chapterId);
    setSelectedTopic("");

    if (chapterId) {
      const data = await fetchData("/topics", { chapterId });
      setTopics(data);
    } else {
      setTopics([]);
    }
  };

  const handleTopicChange = (event) => {
    setSelectedTopic(event.target.value);
  };

  const handleModeChange = (event) => {
    setSelectionMode(event.target.value);
    setUploadedFile(null);
    setFileInputKey((key) => key + 1);
    setUploadError(null);
    setUploadSuccess(null);
    setUploadResponse(null);
  };

  const handleFileChange = (event) => {
    const [file] = event.target.files || [];
    setUploadedFile(file || null);
    if (!file) {
      setFileInputKey((key) => key + 1);
    }
    setUploadError(null);
    setUploadSuccess(null);
    setUploadResponse(null);
  };

  const handleUploadSubmit = async (event) => {
    event.preventDefault();
    if (!selectionMode || !uploadedFile) {
      setUploadError("Select an option and choose a JSON file before submitting.");
      return;
    }

    if (!selectedYear || !selectedSubject || !selectedChapter || !selectedTopic) {
      setUploadError("Complete the year, subject, chapter, and topic selection before uploading.");
      return;
    }

    const endpoint = MODE_ENDPOINTS[selectionMode];
    if (!endpoint) {
      setUploadError("Unsupported option selected.");
      return;
    }

    setUploadError(null);
    setUploadSuccess(null);
    setUploadResponse(null);
    setUploading(true);

    try {
      const fileText = await uploadedFile.text();
      let parsedJson;

      try {
        parsedJson = JSON.parse(fileText);
      } catch (parseError) {
        throw new Error("Uploaded file is not valid JSON.");
      }

      const response = await fetch(buildUrl(endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode: selectionMode,
          yearId: selectedYear,
          subjectId: selectedSubject,
          chapterId: selectedChapter,
          topicId: selectedTopic,
          payload: parsedJson,
        }),
      });

      const responseBody = await response.text();
      let parsedBody;
      if (responseBody) {
        try {
          parsedBody = JSON.parse(responseBody);
        } catch (parseError) {
          parsedBody = null;
        }
      }

      if (!response.ok) {
        const fallbackMessage = `Upload failed with status ${response.status}`;
        const errorMessage = buildUploadErrorMessage(response.status, parsedBody, fallbackMessage);

        setUploadError(errorMessage);
        setUploadSuccess(null);
        setUploadResponse(parsedBody ?? (responseBody || null));
        return;
      }

      let successMessage = "Upload completed successfully.";
      if (parsedBody && typeof parsedBody === "object") {
        if (parsedBody?.message) {
          successMessage = parsedBody.message;
        }
        setUploadResponse(parsedBody);
      } else if (responseBody) {
        successMessage = responseBody;
        setUploadResponse(responseBody);
      } else {
        setUploadResponse(null);
      }

      setUploadSuccess(successMessage);
      setUploadedFile(null);
      setFileInputKey((key) => key + 1);
    } catch (uploadErr) {
      setUploadError(uploadErr?.message || "Upload failed.");
      setUploadSuccess(null);
      if (uploadErr?.body !== undefined) {
        setUploadResponse(uploadErr.body);
      } else {
        setUploadResponse(null);
      }
    } finally {
      setUploading(false);
    }
  };

  const getDisplayName = (item, keys) => {
    if (!item) return undefined;
    return keys.map((key) => item[key]).find((value) => value && `${value}`.trim().length > 0);
  };

  const selectedSummary = useMemo(() => {
    if (!selectedYear) {
      return "Select a year to get started.";
    }

    const yearName = getDisplayName(
      years.find((year) => `${year.year_id}` === selectedYear),
      ["year_name", "name", "title"],
    );
    const subjectName = getDisplayName(
      subjects.find((subject) => `${subject.subject_id}` === selectedSubject),
      ["subject_name", "name", "title"],
    );
    const chapterName = getDisplayName(
      chapters.find((chapter) => `${chapter.chapter_id}` === selectedChapter),
      ["chapter_name", "name", "title"],
    );
    const topicName = getDisplayName(
      topics.find((topic) => `${topic.topic_id}` === selectedTopic),
      ["topic_name", "name", "title"],
    );

    return [yearName, subjectName, chapterName, topicName]
      .filter(Boolean)
      .join(" › ") || "Select a subject to continue.";
  }, [selectedYear, selectedSubject, selectedChapter, selectedTopic, years, subjects, chapters, topics]);

  const yearOptions = years.map((year) => ({
    value: `${year.year_id}`,
    label: getDisplayName(year, ["year_name", "name", "title"]) || `Year ${year.year_id}`,
  }));

  const subjectOptions = subjects.map((subject) => ({
    value: `${subject.subject_id}`,
    label: getDisplayName(subject, ["subject_name", "name", "title"]) || `Subject ${subject.subject_id}`,
  }));

  const chapterOptions = chapters.map((chapter) => ({
    value: `${chapter.chapter_id}`,
    label: getDisplayName(chapter, ["chapter_name", "name", "title"]) || `Chapter ${chapter.chapter_id}`,
  }));

  const topicOptions = topics.map((topic) => ({
    value: `${topic.topic_id}`,
    label: getDisplayName(topic, ["topic_name", "name", "title"]) || `Topic ${topic.topic_id}`,
  }));

  return (
    <main className="app">
      <section className="card">
        <h1>Browse Topics</h1>
        <p className="description">
          Choose a year, subject, chapter, and topic to explore available questions.
        </p>

        <div className="dropdown-grid">
          <Dropdown
            id="year"
            label="Year"
            placeholder="Select year"
            options={yearOptions}
            value={selectedYear}
            onChange={handleYearChange}
            disabled={loading && !years.length}
          />

          <Dropdown
            id="subject"
            label="Subject"
            placeholder={selectedYear ? "Select subject" : "Select a year first"}
            options={subjectOptions}
            value={selectedSubject}
            onChange={handleSubjectChange}
            disabled={!selectedYear || (loading && !subjects.length)}
          />

          <Dropdown
            id="chapter"
            label="Chapter"
            placeholder={selectedSubject ? "Select chapter" : "Select a subject first"}
            options={chapterOptions}
            value={selectedChapter}
            onChange={handleChapterChange}
            disabled={!selectedSubject || (loading && !chapters.length)}
          />

          <Dropdown
            id="topic"
            label="Topic"
            placeholder={selectedChapter ? "Select topic" : "Select a chapter first"}
            options={topicOptions}
            value={selectedTopic}
            onChange={handleTopicChange}
            disabled={!selectedChapter || (loading && !topics.length)}
          />
        </div>

        {loading && <p className="status">Loading…</p>}
        {error && !loading && <p className="status error">{error}</p>}
        {!loading && !error && (
          <p className="status selection" aria-live="polite">
            {selectedSummary}
          </p>
        )}

        <fieldset className="mode-selector">
          <legend>Select Option</legend>
          <div className="radio-options">
            {MODE_OPTIONS.map((option) => (
              <label key={option.value} className="radio-option">
                <input
                  type="radio"
                  name="mode"
                  value={option.value}
                  checked={selectionMode === option.value}
                  onChange={handleModeChange}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {selectionMode && (
          <form className="upload-form" onSubmit={handleUploadSubmit}>
            <label className="file-input" htmlFor="json-upload">
              <span>Upload JSON file</span>
              <input
                key={fileInputKey}
                id="json-upload"
                type="file"
                accept="application/json"
                onChange={handleFileChange}
              />
              {uploadedFile && <p className="file-name">{uploadedFile.name}</p>}
            </label>

            <button type="submit" disabled={!uploadedFile || uploading}>
              {uploading ? "Uploading…" : "Submit"}
            </button>

            {uploadError && <p className="status error">{uploadError}</p>}
            {uploadSuccess && <p className="status success">{uploadSuccess}</p>}
            {uploadResponse && (
              <div className="upload-response" aria-live="polite">
                {typeof uploadResponse === "string" ? (
                  <pre>{uploadResponse}</pre>
                ) : (
                  <>
                    {uploadResponse.status && (
                      <p>
                        <strong>Status:</strong> {uploadResponse.status}
                      </p>
                    )}
                    {uploadResponse.message && (
                      <p>
                        <strong>Message:</strong> {uploadResponse.message}
                      </p>
                    )}
                    {uploadResponse.stats && (
                      <div className="response-block">
                        <h3>Stats</h3>
                        <ul>
                          {Object.entries(uploadResponse.stats).map(([key, value]) => (
                            <li key={key}>
                              <span className="response-key">{key}</span>
                              <span className="response-value">{value}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Array.isArray(uploadResponse.skipped_due_to_images) &&
                      uploadResponse.skipped_due_to_images.length > 0 && (
                        <div className="response-block">
                          <h3>Skipped Due to Images</h3>
                          <ul className="nested-list">
                            {uploadResponse.skipped_due_to_images.map((item) => (
                              <li key={item.key}>
                                <p>
                                  <span className="response-key">Key:</span>{" "}
                                  <span className="response-value">{item.key}</span>
                                </p>
                                {item.reason && (
                                  <p>
                                    <span className="response-key">Reason:</span>{" "}
                                    <span className="response-value">{item.reason}</span>
                                  </p>
                                )}
                                {item.buckets && (
                                  <div>
                                    <p className="response-key">Buckets</p>
                                    <ul>
                                      {Object.entries(item.buckets).map(([bucketKey, bucketValue]) => (
                                        <li key={bucketKey}>
                                          <span className="response-key">{bucketKey}</span>
                                          <span className="response-value">{bucketValue}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    {Array.isArray(uploadResponse.already_uploaded) &&
                      uploadResponse.already_uploaded.length > 0 && (
                        <div className="response-block">
                          <h3>Already Uploaded</h3>
                          <p>
                            <span className="response-key">Total</span>
                            <span className="response-value">
                              {uploadResponse.already_uploaded.length}
                            </span>
                          </p>
                          <ul className="nested-list">
                            {uploadResponse.already_uploaded.map((item, index) => {
                              if (item && typeof item === "object") {
                                const entryKey = item.tg_id || item.key || index;
                                return (
                                  <li key={`already-uploaded-${entryKey}-${index}`}>
                                    {Object.entries(item).map(([key, value]) => {
                                      const displayValue =
                                        toDisplayString(value) ||
                                        (typeof value === "object" ? JSON.stringify(value, null, 2) : "");
                                      return (
                                        <p key={key}>
                                          <span className="response-key">{key}</span>
                                          <span className="response-value">
                                            {displayValue || String(value)}
                                          </span>
                                        </p>
                                      );
                                    })}
                                  </li>
                                );
                              }

                              return (
                                <li key={`already-uploaded-${index}`}>
                                  <span className="response-value">
                                    {toDisplayString(item) ||
                                      (typeof item === "object" ? JSON.stringify(item, null, 2) : String(item))}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    {Array.isArray(uploadResponse.id_map_preview) &&
                      uploadResponse.id_map_preview.length > 0 && (
                        <div className="response-block">
                          <h3>ID Map Preview</h3>
                          <ul className="nested-list">
                            {uploadResponse.id_map_preview.map((item, index) => (
                              <li key={`${item.tg_id}-${index}`}>
                                {Object.entries(item).map(([key, value]) => (
                                  <p key={key}>
                                    <span className="response-key">{key}</span>
                                    <span className="response-value">{value}</span>
                                  </p>
                                ))}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    {uploadResponse.missing_images_summary && (
                      <div className="response-block">
                        <h3>Missing Images Summary</h3>
                        {typeof uploadResponse.missing_images_summary.total_missing_source_files ===
                          "number" && (
                          <p>
                            <span className="response-key">Total Missing Source Files</span>
                            <span className="response-value">
                              {uploadResponse.missing_images_summary.total_missing_source_files}
                            </span>
                          </p>
                        )}
                        {uploadResponse.missing_images_summary.by_bucket && (
                          <div>
                            <p className="response-key">By Bucket</p>
                            <ul>
                              {Object.entries(uploadResponse.missing_images_summary.by_bucket).map(
                                ([bucketKey, bucketValue]) => (
                                  <li key={bucketKey}>
                                    <span className="response-key">{bucketKey}</span>
                                    <span className="response-value">{bucketValue}</span>
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(uploadResponse.missing_images_summary.items) &&
                          uploadResponse.missing_images_summary.items.length > 0 && (
                            <div>
                              <p className="response-key">Items</p>
                              <ul className="nested-list">
                                {uploadResponse.missing_images_summary.items.map((item, index) => (
                                  <li key={index}>
                                    <pre>{JSON.stringify(item, null, 2)}</pre>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                      </div>
                    )}
                    <details>
                      <summary>View raw response</summary>
                      <pre>{JSON.stringify(uploadResponse, null, 2)}</pre>
                    </details>
                  </>
                )}
              </div>
            )}
          </form>
        )}
      </section>
    </main>
  );
}

export default App;
