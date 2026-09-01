import {
    formatDateTime,
    formatDuration,
    formatPaymentMethod,
    formatRupees,
} from "../utils/formatters";

function VehicleInformation({
    exitResult,
    entryResult,
    detectedPlate,
    vehicleAction,
    selectedSpace,
    onReceiptDone,
}) {
    if (exitResult) {
        return (
            <div className="vehicle-info-panel exit-info exit-receipt">
                <div className="vehicle-info-header"><span>EXIT RECEIPT</span></div>
                <h3>{exitResult.license_plate}</h3>
                <div className="vehicle-info-row"><strong>Entry Time</strong><span>{formatDateTime(exitResult.entry_time)}</span></div>
                <div className="vehicle-info-row"><strong>Exit Time</strong><span>{formatDateTime(exitResult.exit_time)}</span></div>
                <div className="vehicle-info-row"><strong>Duration</strong><span>{formatDuration(exitResult.entry_time, exitResult.exit_time)}</span></div>
                <div className="vehicle-info-row"><strong>Parking Space</strong><span>Level {exitResult.level} — {exitResult.space}</span></div>
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
                <button type="button" className="cancel-button receipt-done-button" onClick={onReceiptDone}>Done</button>
            </div>
        );
    }

    if (entryResult) {
        return (
            <div className="vehicle-info-panel entry-info">
                <div className="vehicle-info-header"><span>ENTRY COMPLETED</span></div>
                <h3>{entryResult.license_plate}</h3>
                <div className="vehicle-info-row"><strong>Entry Time</strong><span>{formatDateTime(entryResult.entry_time)}</span></div>
                <div className="vehicle-info-row"><strong>Parking Space</strong><span>Level {entryResult.level} — {entryResult.space}</span></div>
                <div className="vehicle-info-row"><strong>Status</strong><span>Vehicle Parked</span></div>
            </div>
        );
    }

    if (detectedPlate) {
        return (
            <div className="vehicle-info-panel detected-info">
                <div className="vehicle-info-header"><span>VEHICLE DETECTED</span></div>
                <h3>{detectedPlate}</h3>
                <div className="vehicle-info-row"><strong>Action</strong><span>{vehicleAction === "entry" ? "Entry" : vehicleAction === "exit" ? "Exit" : "Awaiting selection"}</span></div>
                {vehicleAction === "entry" && (
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
