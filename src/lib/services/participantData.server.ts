import { nseDownloadText } from "../nse.functions";

export type ParticipantType = "Client" | "DII" | "FII" | "Pro" | "TOTAL";

export type ParticipantDerivativeRow = {
  participantType: ParticipantType;
  futureIndexLong: number;
  futureIndexShort: number;
  futureStockLong: number;
  futureStockShort: number;
  optionIndexCallLong: number;
  optionIndexPutLong: number;
  optionIndexCallShort: number;
  optionIndexPutShort: number;
  optionStockCallLong: number;
  optionStockPutLong: number;
  optionStockCallShort: number;
  optionStockPutShort: number;
  totalLongContracts: number;
  totalShortContracts: number;
};

export type ParticipantReport = {
  reportDate: string;
  rows: ParticipantDerivativeRow[];
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseReportDate(title: string): string {
  const match = title.match(/\bas on\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i);

  if (!match) {
    throw new Error(`Participant report date not found in title: ${title}`);
  }

  const monthMap: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };

  const month = monthMap[match[1]];
  const day = match[2].padStart(2, "0");

  if (!month) {
    throw new Error(`Unsupported participant report month: ${match[1]}`);
  }

  return `${match[3]}-${month}-${day}`;
}

function toNumber(value: string, field: string): number {
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${field}: ${value}`);
  }

  return parsed;
}

export function parseParticipantReport(csv: string): ParticipantReport {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) {
    throw new Error("Participant CSV has insufficient rows");
  }

  const reportDate = parseReportDate(lines[0]);

  const rows = lines.slice(2).map((line) => {
    const cells = parseCsvLine(line);

    if (cells.length < 15) {
      throw new Error(`Participant CSV row has ${cells.length} columns: ${line}`);
    }

    const participantType = cells[0] as ParticipantType;

    if (!["Client", "DII", "FII", "Pro", "TOTAL"].includes(participantType)) {
      throw new Error(`Unknown participant type: ${cells[0]}`);
    }

    return {
      participantType,
      futureIndexLong: toNumber(cells[1], "futureIndexLong"),
      futureIndexShort: toNumber(cells[2], "futureIndexShort"),
      futureStockLong: toNumber(cells[3], "futureStockLong"),
      futureStockShort: toNumber(cells[4], "futureStockShort"),
      optionIndexCallLong: toNumber(cells[5], "optionIndexCallLong"),
      optionIndexPutLong: toNumber(cells[6], "optionIndexPutLong"),
      optionIndexCallShort: toNumber(cells[7], "optionIndexCallShort"),
      optionIndexPutShort: toNumber(cells[8], "optionIndexPutShort"),
      optionStockCallLong: toNumber(cells[9], "optionStockCallLong"),
      optionStockPutLong: toNumber(cells[10], "optionStockPutLong"),
      optionStockCallShort: toNumber(cells[11], "optionStockCallShort"),
      optionStockPutShort: toNumber(cells[12], "optionStockPutShort"),
      totalLongContracts: toNumber(cells[13], "totalLongContracts"),
      totalShortContracts: toNumber(cells[14], "totalShortContracts"),
    };
  });

  return { reportDate, rows };
}

function formatNseDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}${month}${year}`;
}

export async function fetchParticipantReports(date: Date) {
  const dateToken = formatNseDate(date);

  const [oiCsv, volumeCsv] = await Promise.all([
    nseDownloadText(
      `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${dateToken}.csv`,
    ),
    nseDownloadText(
      `https://nsearchives.nseindia.com/content/nsccl/fao_participant_vol_${dateToken}.csv`,
    ),
  ]);

  const oi = parseParticipantReport(oiCsv);
  const volume = parseParticipantReport(volumeCsv);

  if (oi.reportDate !== volume.reportDate) {
    throw new Error(
      `Participant report date mismatch: OI=${oi.reportDate}, volume=${volume.reportDate}`,
    );
  }

  return {
    reportDate: oi.reportDate,
    oi: oi.rows,
    volume: volume.rows,
  };
}