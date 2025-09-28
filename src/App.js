import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "";

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

  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

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
      </section>
    </main>
  );
}

export default App;
