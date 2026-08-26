export function parseBackendDate(value) {
    if (typeof value !== "string") {
        return new Date(value);
    }

    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    return new Date(hasTimezone ? value : `${value}+05:00`);
}

export function formatDateTime(value) {
    if (!value) {
        return "Unknown";
    }

    const date = parseBackendDate(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString("en-PK", {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "Asia/Karachi",
    });
}

export function formatDuration(entryTime, exitTime) {
    const entry = parseBackendDate(entryTime);
    const exit = parseBackendDate(exitTime);

    if (Number.isNaN(entry.getTime()) || Number.isNaN(exit.getTime())) {
        return "Unknown";
    }

    const totalSeconds = Math.max(
        0,
        Math.floor((exit.getTime() - entry.getTime()) / 1000)
    );
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return hours > 0
        ? `${hours} hr ${minutes} min ${seconds} sec`
        : `${minutes} min ${seconds} sec`;
}

export function formatRupees(value) {
    const amount = Number(value);
    return Number.isNaN(amount) ? "Rs 0.00" : `Rs ${amount.toFixed(2)}`;
}

export function formatPaymentMethod(value) {
    if (value === "card") return "Card";
    if (value === "cash") return "Cash";
    return value || "Unknown";
}
