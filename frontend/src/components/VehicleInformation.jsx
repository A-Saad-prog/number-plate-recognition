import {
    formatDateTime,
    formatDuration,
    formatPaymentMethod,
    formatRupees,
    parseBackendDate,
} from "../utils/formatters";

const EXIT_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
];

function formatExitTime(value) {
    if (!value) return "Unknown";
    const date = parseBackendDate(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleTimeString("en-PK", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "Asia/Karachi",
    });
}

function formatExitDate(value) {
    if (!value) return "Unknown";
    const date = parseBackendDate(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    const day = date.toLocaleString("en-PK", { day: "2-digit", timeZone: "Asia/Karachi" });
    const month = Number(date.toLocaleString("en-PK", { month: "numeric", timeZone: "Asia/Karachi" }));
    const year = date.toLocaleString("en-PK", { year: "numeric", timeZone: "Asia/Karachi" });
    return `${day} ${EXIT_MONTHS[month - 1]} ${year}`;
}

function VehicleInformation({
    exitResult,
    entryResult,
    detectedPlate,
    vehicleAction,
    selectedSpace,
    trackingMode = false,
    onReceiptDone,
}) {
    if (exitResult) {
        return (
            <div className="vehicle-info-panel exit-info exit-receipt exit-summary">
                <div className="exit-summary-times">
                    <div className="exit-summary-time">
                        <strong>ENTRY</strong>
                        <b>{formatExitTime(exitResult.entry_time)}</b>
                        <span>{formatExitDate(exitResult.entry_time)}</span>
                    </div>
                    <div className="exit-summary-time">
                        <strong>EXIT</strong>
                        <b>{formatExitTime(exitResult.exit_time)}</b>
                        <span>{formatExitDate(exitResult.exit_time)}</span>
                    </div>
                </div>
                <div className="exit-summary-details">
                    <div className="vehicle-info-row"><strong>Duration</strong><span>{formatDuration(exitResult.entry_time, exitResult.exit_time)}</span></div>
                    {exitResult.billing_enabled !== false && (
                        <>
                            <div className="vehicle-info-row"><strong>Rate</strong><span>{formatRupees(exitResult.rate_per_minute ?? 1.67)} / minute</span></div>
                            <div className="vehicle-info-row"><strong>Payment</strong><span>{formatPaymentMethod(exitResult.payment_method)}</span></div>
                            {Number(exitResult.discount_percent) > 0 && (
                                <div className="vehicle-info-row"><strong>Whitelist Discount</strong><span>{exitResult.discount_percent}%</span></div>
                            )}
                            <div className="vehicle-info-amount"><span>Amount Owed</span><strong>{formatRupees(exitResult.amount)}</strong></div>
                        </>
                    )}
                </div>
                <button type="button" className="confirm-button receipt-done-button" onClick={onReceiptDone}>Done</button>
            </div>
        );
    }

    if (entryResult) {
        return (
            <div className="vehicle-info-panel entry-info">
                <div className="vehicle-info-header"><span>ENTRY COMPLETED</span></div>
                <h3>{entryResult.license_plate}</h3>
                <div className="vehicle-info-row"><strong>Entry Time</strong><span>{formatDateTime(entryResult.entry_time)}</span></div>
                {!trackingMode && <div className="vehicle-info-row"><strong>Parking Space</strong><span>Level {entryResult.level} — {entryResult.space}</span></div>}
                <div className="vehicle-info-row"><strong>Status</strong><span>{trackingMode ? "Vehicle Logged" : "Vehicle Parked"}</span></div>
            </div>
        );
    }

    if (detectedPlate) {
        return (
            <div className="vehicle-info-panel detected-info">
                <div className="vehicle-info-header"><span>VEHICLE DETECTED</span></div>
                <h3>{detectedPlate}</h3>
                <div className="vehicle-info-row"><strong>Action</strong><span>{vehicleAction === "entry" ? "Entry" : vehicleAction === "exit" ? "Exit" : "Awaiting selection"}</span></div>
                {vehicleAction === "entry" && !trackingMode && (
                    <div className="vehicle-info-row"><strong>Parking Space</strong><span>{selectedSpace ? `Level ${selectedSpace.level} — ${selectedSpace.space}` : "Not selected"}</span></div>
                )}
            </div>
        );
    }

    return (
        <div className="vehicle-info-panel empty-info">
            <div className="camera-icon">📷</div>
            <strong>No vehicle information</strong>
            <p>Vehicle information will appear here when a vehicle is detected.</p>
        </div>
    );
}

export default VehicleInformation;
