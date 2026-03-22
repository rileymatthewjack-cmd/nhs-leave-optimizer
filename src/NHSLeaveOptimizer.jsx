import { useState, useCallback, useMemo, useEffect, useRef } from "react";

const UK_BANK_HOLIDAYS = [
  "2025-01-01","2025-04-18","2025-04-21","2025-05-05","2025-05-26","2025-08-25","2025-12-25","2025-12-26",
  "2026-01-01","2026-04-03","2026-04-06","2026-05-04","2026-05-25","2026-08-31","2026-12-25","2026-12-28",
  "2027-01-01","2027-03-26","2027-03-29","2027-05-03","2027-05-31","2027-08-30","2027-12-27","2027-12-28"
];

const SHIFT_TYPES = {
  D: { label: "Day", color: "#2563eb", bg: "#dbeafe" },
  L: { label: "Long Day", color: "#7c3aed", bg: "#ede9fe" },
  N: { label: "Night", color: "#1e1b4b", bg: "#c7d2fe" },
  R: { label: "Rest/Post", color: "#f59e0b", bg: "#fef3c7" },
  O: { label: "Off", color: "#6b7280", bg: "#f3f4f6" },
  W: { label: "Weekend Off", color: "#6b7280", bg: "#f3f4f6" },
  BH: { label: "Bank Hol", color: "#10b981", bg: "#d1fae5" },
  AL: { label: "Annual Leave", color: "#ef4444", bg: "#fee2e2" },
};

const SHIFT_ALIASES = {
  "day": "D", "d": "D", "normal": "D", "standard": "D", "early": "D", "am": "D",
  "9-5": "D", "09:00": "D", "ward": "D", "clinic": "D", "theatre": "D",
  "nwd": "D", "outreach": "D", "normal working day": "D",
  "long": "L", "long day": "L", "ld": "L", "12hr": "L", "12h": "L", "12": "L",
  "extended": "L", "on call": "L", "oncall": "L", "on-call": "L",
  "night": "N", "n": "N", "noc": "N", "twilight": "N",
  "late": "N", "evening": "N",
  "rest": "R", "r": "R", "post": "R", "post-night": "R", "post night": "R",
  "pn": "R", "recovery": "R", "zero": "R", "zero day": "R",
  "off": "O", "o": "O", "free": "O", "nil": "O", "none": "O",
  "": "O", "-": "O", "x": "O",
  "al": "AL", "annual leave": "AL", "leave": "AL", "a/l": "AL", "holiday": "AL",
  "bh": "BH", "bank holiday": "BH", "bank hol": "BH", "ph": "BH", "public holiday": "BH",
  "sl": "O", "study": "O", "study leave": "O", "teaching": "D", "sle": "O",
};

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function dateStr(d) { return d.toISOString().slice(0, 10); }
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getMonthStart(y, m) { return new Date(y, m, 1).getDay(); }
function isBankHoliday(ds) { return UK_BANK_HOLIDAYS.includes(ds); }
function isWeekend(ds) { const day = new Date(ds).getDay(); return day === 0 || day === 6; }

function parseShiftText(raw) {
  if (!raw) return "O";
  const t = raw.toString().trim().toLowerCase();
  if (SHIFT_ALIASES[t] !== undefined) return SHIFT_ALIASES[t];
  for (const [alias, code] of Object.entries(SHIFT_ALIASES)) {
    if (alias && t.includes(alias)) return code;
  }
  if (/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(t)) {
    const startHour = parseInt(t.split(":")[0]);
    const endMatch = t.match(/-\s*(\d{1,2}):/);
    const endHour = endMatch ? parseInt(endMatch[1]) : 17;
    if (startHour >= 19 || endHour <= 8) return "N";
    if (endHour - startHour >= 11) return "L";
    return "D";
  }
  return null;
}

function tryParseDate(raw) {
  if (!raw) return null;
  const t = raw.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  let m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  const d = new Date(t);
  if (!isNaN(d.getTime())) return dateStr(d);
  return null;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  return lines.map(line => {
    const result = [];
    let current = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if ((c === "," || c === "\t") && !inQuotes) { result.push(current.trim()); current = ""; }
      else current += c;
    }
    result.push(current.trim());
    return result;
  });
}

// Month abbreviations for Allocate Optima date format (e.g. "06-Dec-23")
const MONTH_ABBR = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };

function parseAllocateDate(raw) {
  // Matches "06-Dec-23" or "01-Jan-24" etc.
  const m = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mon = MONTH_ABBR[m[2].toLowerCase()];
  if (!mon) return null;
  const year = parseInt(m[3]) > 50 ? `19${m[3]}` : `20${m[3]}`;
  return `${year}-${mon}-${day}`;
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function parsePDF(arrayBuffer) {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const shifts = {};
  const unmapped = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();

    // Group text items into lines by Y coordinate
    const lines = {};
    for (const item of textContent.items) {
      const y = Math.round(item.transform[5]); // Y position
      if (!lines[y]) lines[y] = [];
      lines[y].push({ x: item.transform[4], text: item.str });
    }

    // Sort lines top-to-bottom, items left-to-right
    const sortedYs = Object.keys(lines).map(Number).sort((a, b) => b - a);

    for (const y of sortedYs) {
      const items = lines[y].sort((a, b) => a.x - b.x);
      const lineText = items.map(i => i.text).join(" ");

      // Look for Allocate Optima date pattern anywhere in the line
      const dateMatch = lineText.match(/(\d{1,2}-[A-Za-z]{3}-\d{2})/);
      if (!dateMatch) continue;

      const ds = parseAllocateDate(dateMatch[1]);
      if (!ds) continue;

      // Extract shift name — look for known shift keywords after the date
      // Typical line: "Wed 06-Dec-23 08:30-17:00 Outreach - - Medics ITU 8:30"
      // Or just: "Sat 09-Dec-23" (no shift = off)
      const afterDate = lineText.substring(lineText.indexOf(dateMatch[0]) + dateMatch[0].length).trim();

      if (!afterDate || afterDate === "-" || afterDate.match(/^[\s\-]*$/)) {
        // No shift info — it's an off day
        shifts[ds] = isBankHoliday(ds) ? "BH" : "O";
        continue;
      }

      // Try to find a shift name (Outreach, Night, LD, NWD, A/L, etc.)
      // Look for the Name column value — usually the first word after the time range
      const timePattern = /\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/;
      const timeMatch = afterDate.match(timePattern);

      let shiftName = null;
      if (timeMatch) {
        // Get text after the time
        const afterTime = afterDate.substring(afterDate.indexOf(timeMatch[0]) + timeMatch[0].length).trim();
        // First meaningful word is the shift name
        const words = afterTime.split(/\s+/);
        for (const w of words) {
          if (w === "-" || w === "" || w.match(/^\d/)) continue;
          shiftName = w;
          break;
        }
      } else {
        // No time — might just have the shift name
        const words = afterDate.split(/\s+/);
        for (const w of words) {
          if (w === "-" || w === "" || w.match(/^\d/)) continue;
          shiftName = w;
          break;
        }
      }

      if (shiftName) {
        const code = parseShiftText(shiftName);
        if (code) {
          shifts[ds] = isBankHoliday(ds) && code !== "AL" ? "BH" : code;
        } else {
          // Try time-based detection as fallback
          if (timeMatch) {
            const timeCode = parseShiftText(timeMatch[0]);
            if (timeCode) {
              shifts[ds] = isBankHoliday(ds) && timeCode !== "AL" ? "BH" : timeCode;
            } else {
              unmapped.push({ date: ds, raw: shiftName });
              shifts[ds] = "D";
            }
          } else {
            unmapped.push({ date: ds, raw: shiftName });
            shifts[ds] = "D";
          }
        }
      } else {
        shifts[ds] = isBankHoliday(ds) ? "BH" : "O";
      }
    }
  }

  return { shifts, unmapped, format: "pdf-allocate" };
}

function detectAndParse(rows) {
  if (rows.length < 2) return null;
  const header = rows[0];

  // Strategy 1: Date in a column, shift in another
  let dateCol = -1, shiftCol = -1;
  for (let c = 0; c < Math.min(header.length, 5); c++) {
    let dateCount = 0;
    for (let r = 1; r < Math.min(rows.length, 6); r++) {
      if (rows[r][c] && tryParseDate(rows[r][c])) dateCount++;
    }
    if (dateCount >= 2) { dateCol = c; break; }
  }
  if (dateCol >= 0) {
    for (let c = 0; c < header.length; c++) {
      if (c === dateCol) continue;
      let shiftCount = 0;
      for (let r = 1; r < Math.min(rows.length, 6); r++) {
        if (rows[r][c] && parseShiftText(rows[r][c]) !== null) shiftCount++;
      }
      if (shiftCount >= 2) { shiftCol = c; break; }
    }
    if (shiftCol >= 0) {
      const shifts = {}, unmapped = [];
      for (let r = 1; r < rows.length; r++) {
        const ds = tryParseDate(rows[r][dateCol]);
        if (!ds) continue;
        const raw = rows[r][shiftCol] || "";
        const code = parseShiftText(raw);
        if (code) shifts[ds] = isBankHoliday(ds) && code !== "AL" ? "BH" : code;
        else { unmapped.push({ date: ds, raw }); shifts[ds] = "D"; }
      }
      return { shifts, unmapped, format: "date-per-row" };
    }
  }

  // Strategy 2: Dates across columns
  let dateCols = [];
  for (let c = 0; c < header.length; c++) {
    const ds = tryParseDate(header[c]);
    if (ds) dateCols.push({ col: c, date: ds });
  }
  if (dateCols.length >= 5) {
    let bestRow = -1, bestCount = 0;
    for (let r = 1; r < rows.length; r++) {
      let count = 0;
      for (const dc of dateCols) { if (rows[r][dc.col] && parseShiftText(rows[r][dc.col]) !== null) count++; }
      if (count > bestCount) { bestCount = count; bestRow = r; }
    }
    if (bestRow >= 0 && bestCount >= 3) {
      const shifts = {}, unmapped = [];
      for (const dc of dateCols) {
        const raw = rows[bestRow][dc.col] || "";
        const code = parseShiftText(raw);
        if (code) shifts[dc.date] = isBankHoliday(dc.date) && code !== "AL" ? "BH" : code;
        else { unmapped.push({ date: dc.date, raw }); shifts[dc.date] = "D"; }
      }
      return { shifts, unmapped, format: "date-per-column", detectedRow: bestRow, rowLabel: rows[bestRow][0] || `Row ${bestRow + 1}` };
    }
  }

  // Strategy 3: Raw pattern
  let shiftCodes = [];
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++) {
      const code = parseShiftText(rows[r][c]);
      if (code !== null) shiftCodes.push(code);
    }
  if (shiftCodes.length >= 7) return { pattern: shiftCodes, format: "pattern-only" };
  return null;
}

function optimizeLeave(shifts, alDays, protectedShifts = new Set()) {
  const dates = Object.keys(shifts).sort();
  if (dates.length === 0 || alDays <= 0) return { selectedDates: [], recommendations: [], remaining: alDays };
  const isOff = ds => { const s = shifts[ds]; return s === "O" || s === "W" || s === "R" || s === "BH" || s === "AL"; };
  const isProtected = ds => protectedShifts.has(shifts[ds]);
  // A day is replaceable with AL only if it's not off and not protected
  const canReplace = ds => !isOff(ds) && !isProtected(ds);
  // For streak counting, off days and protected days both count as "not replaceable"
  const isNonReplaceable = ds => !canReplace(ds);

  // Build work blocks of only replaceable days
  let workBlocks = [], i = 0, len = dates.length;
  while (i < len) {
    if (canReplace(dates[i])) { let start = i; while (i < len && canReplace(dates[i])) i++; workBlocks.push({ startIdx: start, endIdx: i - 1 }); }
    else i++;
  }
  const results = [];
  // For adjacent off counting, count both off AND protected days as "adjacent off" for efficiency calc
  const isOffOrProtected = ds => isOff(ds) || isProtected(ds);
  for (const block of workBlocks) {
    const alCost = block.endIdx - block.startIdx + 1;
    let offBefore = 0, idx = block.startIdx - 1;
    while (idx >= 0 && isOffOrProtected(dates[idx])) { offBefore++; idx--; }
    let offAfter = 0; idx = block.endIdx + 1;
    while (idx < len && isOffOrProtected(dates[idx])) { offAfter++; idx++; }
    results.push({ alCost, totalOff: offBefore + alCost + offAfter, efficiency: (offBefore + alCost + offAfter) / alCost, dates: dates.slice(block.startIdx, block.endIdx + 1), offBefore, offAfter, startDate: dates[block.startIdx], endDate: dates[block.endIdx] });
  }
  results.sort((a, b) => b.efficiency - a.efficiency || b.totalOff - a.totalOff);
  let remaining = alDays;
  const selectedDates = new Set(), recommendations = [];
  for (const block of results) {
    if (remaining <= 0) break;
    if (block.alCost <= remaining) { block.dates.forEach(d => selectedDates.add(d)); remaining -= block.alCost; recommendations.push(block); }
  }
  if (remaining > 0) {
    for (const block of results) {
      if (remaining <= 0) break;
      if (block.dates.some(d => selectedDates.has(d))) continue;
      const toTake = Math.min(remaining, block.alCost);
      block.dates.slice(0, toTake).forEach(d => selectedDates.add(d));
      remaining -= toTake;
      recommendations.push({ ...block, alCost: toTake, dates: block.dates.slice(0, toTake), partial: true });
    }
  }
  return { selectedDates: [...selectedDates], recommendations, remaining };
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const ROTA_TEMPLATES = {
  custom: { name: "— Skip, I'll paint manually —", pattern: [] },
  imt_generic: { name: "Generic IMT (Mon-Fri)", pattern: ["D","D","D","D","D","O","O"] },
  imt_oncall_block: { name: "IMT On-Call Block (7-day)", pattern: ["D","D","L","N","N","R","R"] },
  imt_ward: { name: "Ward-based (Mon-Fri)", pattern: ["D","D","D","D","D","W","W"] },
  imt_mixed: { name: "Mixed (14-day cycle)", pattern: ["D","D","D","D","D","O","O","L","N","N","R","R","O","O"] },
};

export default function NHSLeaveOptimizer() {
  const [step, setStep] = useState(0);
  const [rotaStart, setRotaStart] = useState("2026-08-05");
  const [rotaEnd, setRotaEnd] = useState("2027-08-03");
  const [shifts, setShifts] = useState({});
  const [alAllowance, setAlAllowance] = useState(27);
  const [optimResult, setOptimResult] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(null);
  const [paintMode, setPaintMode] = useState("D");
  const [isPainting, setIsPainting] = useState(false);
  const [lockedAL, setLockedAL] = useState(new Set());
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [unmappedShifts, setUnmappedShifts] = useState([]);
  const [patternStartDate, setPatternStartDate] = useState("2026-08-05");
  const [selectedTemplate, setSelectedTemplate] = useState("custom");
  const [fileName, setFileName] = useState("");
  const [previewData, setPreviewData] = useState(null);
  const [protectedShifts, setProtectedShifts] = useState(new Set(["N", "R", "BH"]));
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (rotaStart) {
      const s = new Date(rotaStart);
      setCurrentMonth({ year: s.getFullYear(), month: s.getMonth() });
    }
  }, [rotaStart]);

  const initBlank = useCallback(() => {
    const ns = {};
    let c = new Date(rotaStart);
    const end = new Date(rotaEnd);
    while (c <= end) {
      const ds = dateStr(c);
      if (isBankHoliday(ds)) ns[ds] = "BH";
      else if (isWeekend(ds)) ns[ds] = "W";
      else ns[ds] = "D";
      c = addDays(c, 1);
    }
    setShifts(ns);
  }, [rotaStart, rotaEnd]);

  const applyResult = useCallback((result) => {
    const parsedDates = Object.keys(result.shifts).sort();
    const detectedStart = parsedDates[0];
    const detectedEnd = parsedDates[parsedDates.length - 1];
    const useStart = detectedStart || rotaStart;
    const useEnd = detectedEnd || rotaEnd;
    setRotaStart(useStart);
    setRotaEnd(useEnd);

    const newShifts = {};
    let c = new Date(useStart); const end = new Date(useEnd);
    while (c <= end) {
      const ds = dateStr(c);
      if (result.shifts[ds]) newShifts[ds] = result.shifts[ds];
      else if (isBankHoliday(ds)) newShifts[ds] = "BH";
      else if (isWeekend(ds)) newShifts[ds] = "W";
      else newShifts[ds] = "D";
      c = addDays(c, 1);
    }
    setShifts(newShifts);
    // Auto-lock any AL days that were already in the uploaded rota
    const uploadedAL = new Set();
    Object.entries(newShifts).forEach(([ds, s]) => { if (s === "AL") uploadedAL.add(ds); });
    setLockedAL(uploadedAL);
    setUnmappedShifts(result.unmapped || []);
    setUploadStatus("success");
    setUploadResult(result);
  }, [rotaStart, rotaEnd]);

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setUploadStatus("parsing");

    const isPDF = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

    try {
      if (isPDF) {
        // PDF path
        const arrayBuffer = await file.arrayBuffer();
        const result = await parsePDF(arrayBuffer);
        if (!result || Object.keys(result.shifts).length === 0) {
          setUploadStatus("error");
          setUploadResult(null);
          return;
        }
        setPreviewData(null);
        applyResult(result);
      } else {
        // CSV path
        const text = await file.text();
        const rows = parseCSV(text);
        setPreviewData(rows.slice(0, 8));
        const result = detectAndParse(rows);
        if (!result) { setUploadStatus("error"); setUploadResult(null); return; }
        if (result.format === "pattern-only") { setUploadStatus("pattern-only"); setUploadResult(result); return; }
        applyResult(result);
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("error");
    }
  }, [rotaStart, rotaEnd, applyResult]);

  const applyPattern = useCallback((pattern, startDate) => {
    const ns = {};
    let c = new Date(rotaStart); const end = new Date(rotaEnd);
    const pStart = new Date(startDate);
    let idx = 0;
    while (c <= end) {
      const ds = dateStr(c);
      if (c >= pStart) {
        if (isBankHoliday(ds)) ns[ds] = "BH";
        else ns[ds] = pattern[idx % pattern.length];
        idx++;
      } else {
        if (isBankHoliday(ds)) ns[ds] = "BH";
        else if (isWeekend(ds)) ns[ds] = "W";
        else ns[ds] = "D";
      }
      c = addDays(c, 1);
    }
    setShifts(ns);
  }, [rotaStart, rotaEnd]);

  const handleCellClick = useCallback((ds) => {
    if (step === 2) {
      const ns = { ...shifts }; const nl = new Set(lockedAL);
      if (nl.has(ds)) {
        nl.delete(ds);
        if (isBankHoliday(ds)) ns[ds] = "BH"; else if (isWeekend(ds)) ns[ds] = "W"; else ns[ds] = "D";
      } else if (nl.size < alAllowance && !protectedShifts.has(shifts[ds]) && shifts[ds] !== "O" && shifts[ds] !== "W") {
        nl.add(ds); ns[ds] = "AL";
      }
      setLockedAL(nl); setShifts(ns); return;
    }
    if (step === 1) setShifts(prev => ({ ...prev, [ds]: paintMode }));
  }, [step, paintMode, shifts, lockedAL, protectedShifts, alAllowance]);

  const handleMouseDown = useCallback((ds) => { if (step !== 1) return; setIsPainting(true); setShifts(prev => ({ ...prev, [ds]: paintMode })); }, [step, paintMode]);
  const handleMouseEnter = useCallback((ds) => { if (step !== 1 || !isPainting) return; setShifts(prev => ({ ...prev, [ds]: paintMode })); }, [step, paintMode, isPainting]);
  const handleMouseUp = useCallback(() => setIsPainting(false), []);

  const runOptimizer = useCallback(() => {
    const available = Math.max(0, alAllowance - lockedAL.size);
    const result = optimizeLeave(shifts, available, protectedShifts);
    const ns = { ...shifts };
    // Hard cap: only apply up to 'available' optimized days
    let applied = 0;
    for (const d of result.selectedDates) {
      if (applied >= available) break;
      if (!lockedAL.has(d)) { ns[d] = "AL"; applied++; }
    }
    setShifts(ns); setOptimResult(result); setStep(3);
  }, [shifts, alAllowance, lockedAL, protectedShifts]);

  const clearOptimized = useCallback(() => {
    const ns = { ...shifts };
    Object.keys(ns).forEach(d => {
      if (ns[d] === "AL" && !lockedAL.has(d)) {
        if (isBankHoliday(d)) ns[d] = "BH"; else if (isWeekend(d)) ns[d] = "W"; else ns[d] = "D";
      }
    });
    setShifts(ns); setOptimResult(null); setStep(2);
  }, [shifts, lockedAL]);

  const navigateMonth = (dir) => {
    setCurrentMonth(prev => {
      let m = prev.month + dir, y = prev.year;
      if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
      return { year: y, month: m };
    });
  };

  const formatDate = (ds) => new Date(ds + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  const stats = useMemo(() => {
    const vals = Object.values(shifts);
    const alDays = vals.filter(v => v === "AL").length;
    const sorted = Object.keys(shifts).sort();
    let maxStreak = 0, curStreak = 0, streaks = [], streakStart = null;
    const isOffDay = s => ["O","W","R","BH","AL"].includes(s);
    for (const d of sorted) {
      if (isOffDay(shifts[d])) { if (curStreak === 0) streakStart = d; curStreak++; }
      else {
        if (curStreak >= 3) { const alIn = sorted.slice(sorted.indexOf(streakStart), sorted.indexOf(d)).filter(x => shifts[x] === "AL").length; streaks.push({ start: streakStart, end: sorted[sorted.indexOf(d) - 1], days: curStreak, alUsed: alIn }); }
        if (curStreak > maxStreak) maxStreak = curStreak; curStreak = 0;
      }
    }
    if (curStreak >= 3) streaks.push({ start: streakStart, end: sorted[sorted.length - 1], days: curStreak, alUsed: sorted.slice(sorted.indexOf(streakStart)).filter(x => shifts[x] === "AL").length });
    if (curStreak > maxStreak) maxStreak = curStreak;
    streaks.sort((a, b) => b.days - a.days);
    return { alDays, maxStreak, streaks };
  }, [shifts]);

  const renderMonth = (year, month) => {
    const daysInMonth = getDaysInMonth(year, month);
    const startDay = getMonthStart(year, month);
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(<div key={`b${i}`} style={{ width: 40, height: 40 }} />);
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const shift = shifts[ds]; const st = shift ? SHIFT_TYPES[shift] : null;
      const inRange = ds >= rotaStart && ds <= rotaEnd;
      const locked = lockedAL.has(ds);
      cells.push(
        <div key={ds} onMouseDown={() => inRange && handleMouseDown(ds)} onMouseEnter={() => inRange && handleMouseEnter(ds)} onClick={() => inRange && handleCellClick(ds)}
          style={{ width: 40, height: 40, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: 6,
            cursor: inRange && step >= 1 ? "pointer" : "default", background: !inRange ? "transparent" : st ? st.bg : "#f9fafb",
            border: locked ? "2px solid #ef4444" : shift === "AL" && !locked ? "2px dashed #ef4444" : "1px solid transparent",
            opacity: inRange ? 1 : 0.25, transition: "all 0.1s ease", userSelect: "none" }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: st ? st.color : "#9ca3af", lineHeight: 1 }}>{d}</span>
          {inRange && st && <span style={{ fontSize: 7, fontWeight: 700, color: st.color, textTransform: "uppercase", letterSpacing: 0.5, lineHeight: 1, marginTop: 2 }}>{shift}</span>}
        </div>
      );
    }
    return cells;
  };

  const CalendarBlock = () => currentMonth && (
    <div className="glass" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <button className="btn btn-secondary" onClick={() => navigateMonth(-1)} style={{ padding: "8px 16px" }}>←</button>
        <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{MONTHS[currentMonth.month]} {currentMonth.year}</h3>
        <button className="btn btn-secondary" onClick={() => navigateMonth(1)} style={{ padding: "8px 16px" }}>→</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 40px)", gap: 4, justifyContent: "center" }}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
          <div key={d} style={{ width: 40, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{d}</div>
        ))}
        {renderMonth(currentMonth.year, currentMonth.month)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16, justifyContent: "center" }}>
        {Object.entries(SHIFT_TYPES).map(([k, v]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: v.bg, border: k === "AL" ? "2px dashed #ef4444" : "1px solid rgba(255,255,255,0.1)" }} />
            <span style={{ color: "#94a3b8", fontWeight: 500 }}>{v.label}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div onMouseUp={handleMouseUp} style={{ fontFamily: "'IBM Plex Sans', 'SF Pro Display', -apple-system, sans-serif", minHeight: "100vh", background: "linear-gradient(160deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)", color: "#e2e8f0", padding: "24px 16px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
        .glass { background: rgba(255,255,255,0.05); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; }
        .btn { padding: 10px 20px; border: none; border-radius: 10px; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; }
        .btn-primary { background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; }
        .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(59,130,246,0.4); }
        .btn-secondary { background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.12); }
        .btn-secondary:hover { background: rgba(255,255,255,0.12); }
        .btn-success { background: linear-gradient(135deg, #10b981, #059669); color: white; }
        .btn-success:hover { transform: translateY(-1px); box-shadow: 0 4px 20px rgba(16,185,129,0.4); }
        input[type="date"], input[type="number"], select { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #e2e8f0; padding: 10px 14px; border-radius: 10px; font-family: inherit; font-size: 14px; outline: none; }
        input:focus, select:focus { border-color: #3b82f6; }
        .paint-btn { padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; border: 2px solid transparent; transition: all 0.15s; font-family: inherit; }
        .paint-btn.active { border-color: white; transform: scale(1.05); box-shadow: 0 0 12px rgba(255,255,255,0.2); }
        .streak-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px 18px; margin-bottom: 10px; }
        .fade-in { animation: fadeIn 0.4s ease both; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .step-dot { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; transition: all 0.3s; }
        .step-line { width: 32px; height: 2px; background: rgba(255,255,255,0.12); border-radius: 1px; }
        .upload-zone { border: 2px dashed rgba(255,255,255,0.15); border-radius: 16px; padding: 40px 24px; text-align: center; cursor: pointer; transition: all 0.3s; }
        .upload-zone:hover { border-color: #3b82f6; background: rgba(59,130,246,0.04); }
        .upload-zone.active { border-color: #10b981; background: rgba(16,185,129,0.04); }
        .unmapped-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px; margin-bottom: 6px; font-size: 13px; }
        .divider { width: 100%; height: 1px; background: rgba(255,255,255,0.06); margin: 20px 0; }
      `}</style>

      {/* Header */}
      <div style={{ maxWidth: 900, margin: "0 auto 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, background: "linear-gradient(135deg, #60a5fa, #a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>NHS Leave Optimizer</h1>
            <p style={{ fontSize: 13, color: "#64748b", marginTop: 4, fontWeight: 500 }}>Maximize your time off from your IMT rota</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {["Upload", "Review", "Lock AL", "Results"].map((label, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="step-dot" onClick={() => step > i && setStep(i)}
                  style={{ background: step >= i ? "linear-gradient(135deg, #3b82f6, #2563eb)" : "rgba(255,255,255,0.06)", color: step >= i ? "white" : "#475569", cursor: step > i ? "pointer" : "default" }}>{i + 1}</div>
                {i < 3 && <div className="step-line" style={{ background: step > i ? "#3b82f6" : undefined }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* ═══ STEP 0: Upload ═══ */}
        {step === 0 && (
          <div className="fade-in">
            <div className="glass" style={{ padding: 28, marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Upload Your Rota</h2>
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20, lineHeight: 1.6 }}>
                Upload a CSV or PDF export of your rota from HealthRoster, Allocate, CLWRota, or similar. The parser auto-detects dates and shift types across multiple common formats.
              </p>

              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt,.pdf" style={{ display: "none" }} onChange={handleFileUpload} />

              <div className={`upload-zone ${uploadStatus === "success" ? "active" : ""}`} onClick={() => fileInputRef.current?.click()}>
                {!uploadStatus && (<>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Click to upload your rota file</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>PDF, CSV, TSV, or tab-delimited text · Supports Allocate Optima PDF exports</div>
                </>)}
                {uploadStatus === "parsing" && <div style={{ fontSize: 15 }}>Parsing…</div>}
                {uploadStatus === "success" && (<>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#10b981" }}>Rota parsed successfully</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                    {fileName} · {Object.keys(shifts).length} days loaded · {uploadResult?.format === "pdf-allocate" ? "Allocate Optima PDF" : uploadResult?.format === "date-per-row" ? "date-per-row format" : uploadResult?.format === "date-per-column" ? `grid format (row: ${uploadResult.rowLabel})` : "pattern"}
                  </div>
                </>)}
                {uploadStatus === "pattern-only" && (<>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>🔄</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#f59e0b" }}>Pattern detected (no dates found)</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{uploadResult?.pattern?.length} shift codes — set start date below</div>
                </>)}
                {uploadStatus === "error" && (<>
                  <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#ef4444" }}>Couldn't auto-parse this file</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Try a different export, or continue to set your rota manually</div>
                </>)}
              </div>

              {/* Raw preview */}
              {previewData && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>File Preview</div>
                  <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 12, overflowX: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.8 }}>
                    {previewData.map((row, i) => (
                      <div key={i} style={{ whiteSpace: "nowrap", color: i === 0 ? "#60a5fa" : "#cbd5e1" }}>
                        {row.map((cell, j) => <span key={j} style={{ display: "inline-block", minWidth: 80, marginRight: 8, padding: "2px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>{cell || "—"}</span>)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmapped warnings */}
              {unmappedShifts.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#f59e0b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>⚠ Unrecognised shifts ({unmappedShifts.length}) — defaulted to Day</div>
                  {unmappedShifts.slice(0, 5).map((u, i) => (
                    <div key={i} className="unmapped-row">
                      <span style={{ color: "#94a3b8" }}>{formatDate(u.date)}</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", color: "#f59e0b" }}>"{u.raw}"</span>
                      <span style={{ color: "#64748b", fontSize: 11 }}>→ mapped as Day</span>
                    </div>
                  ))}
                  {unmappedShifts.length > 5 && <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>…and {unmappedShifts.length - 5} more (edit in next step)</div>}
                </div>
              )}

              <div className="divider" />

              {/* Accepted shift codes reference */}
              <div style={{ marginTop: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Recognised Shift Keywords</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[
                    { codes: "day, d, ward, clinic, early, am, 9-5", type: "Day", bg: SHIFT_TYPES.D.bg, color: SHIFT_TYPES.D.color },
                    { codes: "long, ld, 12hr, on call", type: "Long Day", bg: SHIFT_TYPES.L.bg, color: SHIFT_TYPES.L.color },
                    { codes: "night, n, noc, late, twilight", type: "Night", bg: SHIFT_TYPES.N.bg, color: SHIFT_TYPES.N.color },
                    { codes: "rest, r, post, pn, zero, recovery", type: "Rest", bg: SHIFT_TYPES.R.bg, color: SHIFT_TYPES.R.color },
                    { codes: "off, o, free, nil, x, -", type: "Off", bg: SHIFT_TYPES.O.bg, color: SHIFT_TYPES.O.color },
                    { codes: "al, annual leave, leave, holiday", type: "AL", bg: SHIFT_TYPES.AL.bg, color: SHIFT_TYPES.AL.color },
                  ].map((g, i) => (
                    <div key={i} style={{ background: g.bg, color: g.color, padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, lineHeight: 1.5 }}>
                      {g.type}: <span style={{ fontWeight: 400, opacity: 0.8 }}>{g.codes}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Date range + AL */}
            <div className="glass" style={{ padding: 24, marginBottom: 16 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Rota Period & Leave Allowance</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 8 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Rota Start</label>
                  <input type="date" value={rotaStart} onChange={e => setRotaStart(e.target.value)} style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Rota End</label>
                  <input type="date" value={rotaEnd} onChange={e => setRotaEnd(e.target.value)} style={{ width: "100%" }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>AL Days</label>
                  <input type="number" value={alAllowance} onChange={e => setAlAllowance(parseInt(e.target.value) || 0)} min={0} max={40} style={{ width: "100%" }} />
                </div>
              </div>
              <span style={{ fontSize: 11, color: "#64748b" }}>NHS default: 27 days + bank holidays</span>

              {uploadStatus === "pattern-only" && uploadResult?.pattern && (
                <div style={{ marginTop: 16, padding: 14, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 8 }}>No dates in file — set where the pattern starts:</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input type="date" value={patternStartDate} onChange={e => setPatternStartDate(e.target.value)} />
                    <button className="btn btn-secondary" style={{ fontSize: 12, padding: "8px 14px" }} onClick={() => { applyPattern(uploadResult.pattern, patternStartDate); setUploadStatus("success"); }}>Apply Pattern</button>
                  </div>
                </div>
              )}
            </div>

            <button className="btn btn-primary" onClick={() => { if (Object.keys(shifts).length === 0) initBlank(); setStep(1); }}>
              {uploadStatus === "success" ? "Review & Edit Rota →" : "Set Rota Manually →"}
            </button>
          </div>
        )}

        {/* ═══ STEP 1: Review / Edit ═══ */}
        {step === 1 && (
          <div className="fade-in">
            <div className="glass" style={{ padding: 20, marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
                {uploadStatus === "success" ? "Review & Edit Your Rota" : "Paint Your Rota"}
              </h2>
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>
                {uploadStatus === "success"
                  ? "Your uploaded rota is shown below. Click or drag to correct any mis-parsed shifts, or apply a template to fill gaps."
                  : "Choose a template to auto-fill, or click and drag on the calendar to paint shifts."}
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Apply Template</label>
                  <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} style={{ width: "100%" }}>
                    {Object.entries(ROTA_TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
                  </select>
                </div>
                {selectedTemplate !== "custom" && (<>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>From</label>
                    <input type="date" value={patternStartDate} onChange={e => setPatternStartDate(e.target.value)} />
                  </div>
                  <button className="btn btn-secondary" onClick={() => { const t = ROTA_TEMPLATES[selectedTemplate]; if (t.pattern.length) applyPattern(t.pattern, patternStartDate); }}>Apply</button>
                </>)}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {Object.entries(SHIFT_TYPES).filter(([k]) => k !== "AL").map(([key, val]) => (
                  <button key={key} className={`paint-btn ${paintMode === key ? "active" : ""}`} style={{ background: val.bg, color: val.color }} onClick={() => setPaintMode(key)}>{val.label}</button>
                ))}
              </div>
            </div>
            <CalendarBlock />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setStep(0)}>← Back</button>
              <button className="btn btn-primary" onClick={() => setStep(2)}>Continue to Lock AL →</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 2: Lock AL ═══ */}
        {step === 2 && (
          <div className="fade-in">
            <div className="glass" style={{ padding: 20, marginBottom: 16 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Lock Must-Have Leave & Optimize</h2>
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>
                Click any <strong style={{ color: "#ef4444" }}>working day</strong> to lock it as annual leave (holidays already booked). Then hit optimize to auto-fill the rest for maximum consecutive time off.
              </p>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 10, padding: "10px 16px" }}>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>AL BUDGET</span>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#ef4444", fontFamily: "'JetBrains Mono', monospace" }}>{alAllowance - lockedAL.size} <span style={{ fontSize: 12, fontWeight: 500, color: "#94a3b8" }}>of {alAllowance}</span></div>
                </div>
                <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "10px 16px" }}>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>LOCKED</span>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#f59e0b", fontFamily: "'JetBrains Mono', monospace" }}>{lockedAL.size}</div>
                </div>
              </div>

              {/* Protected shift types */}
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Can't book AL over these shift types:</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {Object.entries(SHIFT_TYPES).filter(([k]) => !["O","W","AL"].includes(k)).map(([key, val]) => {
                    const isProtected = protectedShifts.has(key);
                    return (
                      <button key={key} onClick={() => {
                        const ns = new Set(protectedShifts);
                        if (isProtected) ns.delete(key); else ns.add(key);
                        setProtectedShifts(ns);
                      }}
                      style={{
                        padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                        cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                        background: isProtected ? val.bg : "rgba(255,255,255,0.04)",
                        color: isProtected ? val.color : "#475569",
                        border: isProtected ? `2px solid ${val.color}` : "2px solid rgba(255,255,255,0.08)",
                        opacity: isProtected ? 1 : 0.5,
                      }}>
                        {isProtected ? "🔒 " : ""}{val.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <CalendarBlock />
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Edit Rota</button>
              <button className="btn btn-success" onClick={runOptimizer} style={{ fontSize: 16, padding: "12px 28px" }}>✨ Optimize My Leave</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: Results ═══ */}
        {step === 3 && (
          <div className="fade-in">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }}>
              {[
                { label: "AL Used", value: stats.alDays, color: "#ef4444" },
                { label: "AL Remaining", value: alAllowance - stats.alDays, color: "#f59e0b" },
                { label: "Longest Break", value: `${stats.maxStreak}d`, color: "#10b981" },
                { label: "Breaks 3+ days", value: stats.streaks.length, color: "#8b5cf6" },
              ].map((s, i) => (
                <div key={i} className="glass" style={{ padding: "16px 18px", textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
                </div>
              ))}
            </div>
            <CalendarBlock />
            <div className="glass" style={{ padding: 20, marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>Your Breaks (3+ consecutive days off)</h3>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {stats.streaks.map((s, i) => (
                  <div key={i} className="streak-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{formatDate(s.start)} → {formatDate(s.end)}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{s.alUsed > 0 ? `${s.alUsed} AL day${s.alUsed > 1 ? "s" : ""} used` : "No AL needed"}</div>
                    </div>
                    <div style={{ background: s.days >= 9 ? "linear-gradient(135deg, #10b981, #059669)" : s.days >= 5 ? "linear-gradient(135deg, #3b82f6, #2563eb)" : "rgba(255,255,255,0.08)", padding: "6px 14px", borderRadius: 20, fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: "white" }}>{s.days} days</div>
                  </div>
                ))}
                {stats.streaks.length === 0 && <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: 20 }}>No breaks of 3+ days found.</p>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-secondary" onClick={clearOptimized}>← Re-optimize</button>
              <button className="btn btn-secondary" onClick={() => { setLockedAL(new Set()); setOptimResult(null); setStep(1); }}>Edit Rota</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
