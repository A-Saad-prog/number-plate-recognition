import JSZip from "jszip";

// 2+ selected tables are bundled into one ZIP file.

export const PARKING_ACTIVITY_EXPORT_TABLES = [
    { id: "live_sessions", label: "Live Parking" },
    { id: "space_status", label: "Space Status" },
    { id: "vehicles", label: "Vehicles" },
    { id: "history", label: "Parking History" },
];

const PRESET_MS = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
};

const PRESET_LABELS = {
    "1h": "Last-hour",
    "24h": "Last-24-hours",
    "7d": "Last-7-days",
    "30d": "Last-30-days",
    custom: "Custom",
};

function parseDate(value) {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value) {
    const date = parseDate(value);

    if (!date) return "-";

    return new Intl.DateTimeFormat("en-PK", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "Asia/Karachi",
    }).format(date);
}

function formatFilenameDate(value) {
    const date = parseDate(value);

    if (!date) return "Unknown";

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${year}-${month}-${day}-${hours}${minutes}`;
}

function formatYesNo(value) {
    return value ? "Yes" : "No";
}

function formatMoney(value) {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    const amount = Number(value);

    return Number.isFinite(amount)
        ? `Rs ${amount.toFixed(2)}`
        : String(value);
}

function resolveRange(rangePreset, customStart, customEnd) {
    const now = new Date();

    if (rangePreset === "custom") {
        const start = parseDate(customStart);
        const end = parseDate(customEnd);

        if (!start || !end) {
            throw new Error(
                "Select both custom start and end date/time."
            );
        }

        if (start.getTime() > end.getTime()) {
            throw new Error(
                "Custom start date/time must be before the end date/time."
            );
        }

        return {
            start,
            end,
            filenameLabel:
                `Custom-${formatFilenameDate(start)}-to-${formatFilenameDate(end)}`,
        };
    }

    const duration =
        PRESET_MS[rangePreset] ?? PRESET_MS["24h"];

    return {
        start: new Date(now.getTime() - duration),
        end: now,
        filenameLabel:
            PRESET_LABELS[rangePreset] || PRESET_LABELS["24h"],
    };
}

function timestampInRange(value, start, end) {
    const date = parseDate(value);

    if (!date) return false;

    const time = date.getTime();

    return (
        time >= start.getTime() &&
        time <= end.getTime()
    );
}

function intervalOverlapsRange(
    startValue,
    endValue,
    rangeStart,
    rangeEnd
) {
    const start = parseDate(startValue);

    if (!start) return false;

    const end = parseDate(endValue) || new Date();

    return (
        start.getTime() <= rangeEnd.getTime() &&
        end.getTime() >= rangeStart.getTime()
    );
}

function escapeCsvValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    const text = String(value);

    if (
        text.includes(",") ||
        text.includes('"') ||
        text.includes("\n") ||
        text.includes("\r")
    ) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function createCsv(headers, rows) {
    const lines = [
        headers.map(escapeCsvValue).join(","),
        ...rows.map((row) =>
            row.map(escapeCsvValue).join(",")
        ),
    ];

    // UTF-8 BOM helps Excel open the CSV correctly.
    return `\uFEFF${lines.join("\r\n")}`;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}

function downloadCsv(filename, headers, rows) {
    const csv = createCsv(headers, rows);

    const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;",
    });

    downloadBlob(blob, filename);
}

function buildLiveSessions(activity, range) {
    const rows = (activity.live_sessions || [])
        .filter((session) =>
            intervalOverlapsRange(
                session.entry_time,
                null,
                range.start,
                range.end
            )
        )
        .map((session) => [
            session.plate || "-",
            session.space || "Tracking",
            formatDateTime(session.entry_time),
            `${Number(session.duration_minutes || 0)} min`,
            session.session_id ?? "-",
        ]);

    return {
        filename: "Live-Parking",
        headers: [
            "Plate",
            "Space",
            "Entry Time",
            "Duration",
            "Session ID",
        ],
        rows,
    };
}

function buildSpaceStatus(activity) {
    const rows = (activity.space_status?.spaces || []).map(
        (space) => [
            space.level ?? "-",
            space.space || "-",
            space.is_occupied
                ? "Occupied"
                : "Available",
            space.plate || "-",
        ]
    );

    return {
        filename: "Space-Status",
        headers: [
            "Level",
            "Space",
            "Status",
            "Plate",
        ],
        rows,
    };
}

function buildVehicles(activity, range) {
    const rows = (activity.vehicles || [])
        .filter((vehicle) => {
            const lastEntryInRange = timestampInRange(
                vehicle.last_entry,
                range.start,
                range.end
            );

            const lastExitInRange = timestampInRange(
                vehicle.last_exit,
                range.start,
                range.end
            );

            const lastEntry = parseDate(
                vehicle.last_entry
            );

            const parkedDuringRange =
                Boolean(vehicle.currently_parked) &&
                lastEntry &&
                lastEntry.getTime() <=
                    range.end.getTime();

            return (
                lastEntryInRange ||
                lastExitInRange ||
                parkedDuringRange
            );
        })
        .map((vehicle) => [
            vehicle.plate || "-",
            Number(vehicle.total_visits || 0),
            formatDateTime(vehicle.last_entry),
            formatDateTime(vehicle.last_exit),
            formatYesNo(vehicle.currently_parked),
            formatYesNo(vehicle.whitelisted),
        ]);

    return {
        filename: "Vehicles",
        headers: [
            "Plate",
            "Total Visits",
            "Last Entry",
            "Last Exit",
            "Currently Parked",
            "Whitelisted",
        ],
        rows,
    };
}

function buildHistory(activity, range) {
    const billingEnabled =
        Boolean(activity.billing_enabled);

    const headers = [
        "Plate",
        "Entry Time",
        "Exit Time",
        "Duration",
        "Space",
    ];

    if (billingEnabled) {
        headers.push(
            "Payment Method",
            "Amount",
            "Discount"
        );
    }

    const rows = (activity.history || [])
        .filter((item) =>
            intervalOverlapsRange(
                item.entry_time,
                item.exit_time,
                range.start,
                range.end
            )
        )
        .map((item) => {
            const row = [
                item.plate || "-",
                formatDateTime(item.entry_time),
                formatDateTime(item.exit_time),
                `${Number(item.duration_minutes || 0)} min`,
                item.space || "-",
            ];

            if (billingEnabled) {
                row.push(
                    item.payment_method || "-",
                    formatMoney(item.amount),
                    item.discount_percent
                        ? `${item.discount_percent}%`
                        : "0%"
                );
            }

            return row;
        });

    return {
        filename: "Parking-History",
        headers,
        rows,
    };
}

function buildTable(tableId, activity, range) {
    if (tableId === "live_sessions") {
        return buildLiveSessions(activity, range);
    }

    if (tableId === "space_status") {
        return buildSpaceStatus(activity);
    }

    if (tableId === "vehicles") {
        return buildVehicles(activity, range);
    }

    if (tableId === "history") {
        return buildHistory(activity, range);
    }

    return null;
}

export async function exportParkingActivityCsv(
    activity,
    options = {}
) {
    if (!activity) {
        throw new Error(
            "Parking activity data is not loaded yet."
        );
    }

    const selectedTables = options.tables || [];

    if (selectedTables.length === 0) {
        throw new Error(
            "Select at least one table to export."
        );
    }

    const range = resolveRange(
        options.rangePreset || "24h",
        options.customStart,
        options.customEnd
    );

    const exports = selectedTables
        .map((tableId) =>
            buildTable(tableId, activity, range)
        )
        .filter(Boolean);

    if (exports.length === 0) {
        throw new Error(
            "No valid tables were selected."
        );
    }

    // ==========================================
    // ONE TABLE -> NORMAL CSV
    // ==========================================

    if (selectedTables.length === 1) {
        const table = exports[0];

        if (!table) {
            throw new Error(
                "The selected table could not be exported."
            );
        }

        downloadCsv(
            `${range.filenameLabel}-${table.filename}.csv`,
            table.headers,
            table.rows
        );

        return;
    }

    // ==========================================
    // MULTIPLE TABLES -> ONE ZIP
    // ==========================================

    if (exports.length !== selectedTables.length) {
        throw new Error(
            "One or more selected tables could not be exported."
        );
    }

    const zip = new JSZip();

    for (const table of exports) {
        const csv = createCsv(
            table.headers,
            table.rows
        );

        zip.file(
            `${range.filenameLabel}-${table.filename}.csv`,
            csv
        );
    }

    const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
            level: 6,
        },
    });

    downloadBlob(
        zipBlob,
        `${range.filenameLabel}-Activity.zip`
    );
}