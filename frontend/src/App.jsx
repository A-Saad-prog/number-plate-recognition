import { useEffect, useState } from "react";

import {
    getAvailableSpace,
    getDetectedPlate,
    registerEntry,
    exitUsingPlate,
    exitUsingQR,
} from "./services/api";

import "./App.css";

function App() {
    // ============================================================
    // Detected plate / entry state
    // ============================================================

    const [detectedPlate, setDetectedPlate] = useState("");

    const [entryLoading, setEntryLoading] = useState(false);

    const [entryError, setEntryError] = useState("");

    const [entryResult, setEntryResult] = useState(null);


    // ============================================================
    // Parking state
    // ============================================================

    const [availableSpace, setAvailableSpace] = useState(null);

    const [parkingLoading, setParkingLoading] = useState(false);

    const [parkingError, setParkingError] = useState("");


    // ============================================================
    // Exit state
    // ============================================================

    const [exitPlate, setExitPlate] = useState("");

    const [qrCode, setQrCode] = useState("");

    const [exitResult, setExitResult] = useState(null);

    const [exitError, setExitError] = useState("");

    const [exitLoading, setExitLoading] = useState(false);


    // ============================================================
    // Get detected license plate
    // ============================================================

    async function checkDetectedPlate() {
        try {
            const result = await getDetectedPlate();

            if (
                result.success &&
                result.license_plate &&
                !detectedPlate
            ) {
                setDetectedPlate(
                    result.license_plate.toUpperCase()
                );

                setEntryError("");
            }
        } catch (error) {
            console.error(
                "Could not get detected plate:",
                error
            );
        }
    }


    // ============================================================
    // Get parking status
    // ============================================================

    async function loadAvailableSpace() {
        try {
            setParkingLoading(true);
            setParkingError("");

            const result = await getAvailableSpace();

            setAvailableSpace(result);
        } catch (error) {
            setParkingError(error.message);
        } finally {
            setParkingLoading(false);
        }
    }


    // ============================================================
    // Poll detected plate
    // ============================================================

    useEffect(() => {
        checkDetectedPlate();

        const interval = setInterval(() => {
            checkDetectedPlate();
        }, 1000);

        return () => {
            clearInterval(interval);
        };
    }, [detectedPlate]);


    // ============================================================
    // Poll parking status
    // ============================================================

    useEffect(() => {
        loadAvailableSpace();

        const interval = setInterval(() => {
            loadAvailableSpace();
        }, 3000);

        return () => {
            clearInterval(interval);
        };
    }, []);


    // ============================================================
    // Confirm vehicle entry
    // ============================================================

    async function handleConfirmEntry() {
        const plate = detectedPlate.trim().toUpperCase();

        if (!plate) {
            setEntryError(
                "Please enter a license plate."
            );
            return;
        }

        setEntryLoading(true);
        setEntryError("");
        setEntryResult(null);

        try {
            const result = await registerEntry(plate);

            if (!result.success) {
                setEntryError(
                    result.error ||
                    "Vehicle entry failed."
                );
                return;
            }

            setEntryResult(result.vehicle);

            setDetectedPlate("");

            await loadAvailableSpace();
        } catch (error) {
            setEntryError(error.message);
        } finally {
            setEntryLoading(false);
        }
    }


    // ============================================================
    // Cancel detected vehicle
    // ============================================================

    function handleCancelDetection() {
        setDetectedPlate("");

        setEntryError("");
    }


    // ============================================================
    // Exit using license plate
    // ============================================================

    async function handlePlateExit() {
        const plate = exitPlate.trim().toUpperCase();

        if (!plate) {
            setExitError(
                "Please enter a license plate."
            );
            return;
        }

        setExitLoading(true);
        setExitError("");
        setExitResult(null);

        try {
            const result = await exitUsingPlate(plate);

            if (!result.success) {
                setExitError(
                    result.error ||
                    "Vehicle exit failed."
                );
                return;
            }

            setExitResult(result.vehicle);

            setExitPlate("");

            await loadAvailableSpace();
        } catch (error) {
            setExitError(error.message);
        } finally {
            setExitLoading(false);
        }
    }


    // ============================================================
    // Exit using QR code
    // ============================================================

    async function handleQRExit() {
        const code = qrCode.trim();

        if (!code) {
            setExitError(
                "Please enter the QR code."
            );
            return;
        }

        setExitLoading(true);
        setExitError("");
        setExitResult(null);

        try {
            const result = await exitUsingQR(code);

            if (!result.success) {
                setExitError(
                    result.error ||
                    "Vehicle exit failed."
                );
                return;
            }

            setExitResult(result.vehicle);

            setQrCode("");

            await loadAvailableSpace();
        } catch (error) {
            setExitError(error.message);
        } finally {
            setExitLoading(false);
        }
    }


    // ============================================================
    // UI
    // ============================================================

    return (
        <div className="app">

            {/* =====================================================
                HEADER
            ===================================================== */}

            <header className="header">

                <div>
                    <h1>Parking Garage</h1>

                    <p>
                        License Plate Parking Management System
                    </p>
                </div>

            </header>


            <main className="container">

                {/* =================================================
                    PARKING STATUS
                ================================================= */}

                <section className="card parking-status">

                    <h2>Parking Status</h2>

                    <p className="description">
                        Current parking availability.
                    </p>

                    {parkingLoading && !availableSpace && (
                        <div className="status-message">
                            Loading parking status...
                        </div>
                    )}

                    {parkingError && (
                        <div className="error">
                            {parkingError}
                        </div>
                    )}

                    {availableSpace && (
                        <div className="parking-summary">

                            {availableSpace.available ? (

                                <div className="space-status available">

                                    <span className="status-indicator">
                                        ●
                                    </span>

                                    <div>
                                        <strong>
                                            Parking Available
                                        </strong>

                                        <p>
                                            Level{" "}
                                            {availableSpace.level}
                                            {" "}— Space{" "}
                                            {availableSpace.space}
                                        </p>
                                    </div>

                                </div>

                            ) : (

                                <div className="space-status unavailable">

                                    <span className="status-indicator">
                                        ●
                                    </span>

                                    <div>
                                        <strong>
                                            Parking Full
                                        </strong>

                                        <p>
                                            No parking spaces
                                            are currently
                                            available.
                                        </p>
                                    </div>

                                </div>

                            )}

                        </div>
                    )}

                </section>


                {/* =================================================
                    VEHICLE ENTRY
                ================================================= */}

                <section className="card entry-card">

                    <h2>Vehicle Entry</h2>

                    <p className="description">
                        The camera automatically detects the
                        vehicle's license plate.
                    </p>


                    {/* =================================================
                        DETECTED PLATE
                    ================================================= */}

                    {detectedPlate ? (

                        <div className="detected-panel">

                            <div className="detected-header">

                                <div>
                                    <span className="detected-label">
                                        Vehicle Detected
                                    </span>

                                    <h3>
                                        {detectedPlate}
                                    </h3>
                                </div>

                                <span className="live-indicator">
                                    ● LIVE
                                </span>

                            </div>


                            <p className="description">
                                Verify the detected license plate.
                                You can correct it before confirming
                                the entry.
                            </p>


                            <label className="field-label">
                                License Plate
                            </label>

                            <input
                                className="plate-input"
                                type="text"
                                value={detectedPlate}
                                onChange={(event) => {
                                    setDetectedPlate(
                                        event.target.value.toUpperCase()
                                    );
                                    setEntryError("");
                                }}
                                placeholder="ABC-1234"
                            />


                            {entryError && (
                                <div className="error">
                                    {entryError}
                                </div>
                            )}


                            <div className="confirmation-buttons">

                                <button
                                    className="confirm-button"
                                    onClick={
                                        handleConfirmEntry
                                    }
                                    disabled={
                                        entryLoading
                                    }
                                >
                                    {entryLoading
                                        ? "Confirming..."
                                        : "Confirm Entry"}
                                </button>


                                <button
                                    className="cancel-button"
                                    onClick={
                                        handleCancelDetection
                                    }
                                    disabled={
                                        entryLoading
                                    }
                                >
                                    Cancel
                                </button>

                            </div>

                        </div>

                    ) : (

                        <div className="waiting-panel">

                            <div className="camera-icon">
                                📷
                            </div>

                            <strong>
                                Waiting for vehicle...
                            </strong>

                            <p>
                                Position a vehicle in front
                                of the camera.
                            </p>

                        </div>

                    )}


                    {/* =================================================
                        ENTRY RESULT
                    ================================================= */}

                    {entryResult && (

                        <div className="result success-result">

                            <h3>
                                Vehicle Entry Confirmed
                            </h3>


                            <div className="result-row">
                                <strong>
                                    License Plate:
                                </strong>

                                <span>
                                    {entryResult.license_plate}
                                </span>
                            </div>


                            <div className="result-row">
                                <strong>
                                    Level:
                                </strong>

                                <span>
                                    {entryResult.level}
                                </span>
                            </div>


                            <div className="result-row">
                                <strong>
                                    Parking Space:
                                </strong>

                                <span>
                                    {entryResult.space}
                                </span>
                            </div>


                            <div className="result-row">
                                <strong>
                                    Entry Time:
                                </strong>

                                <span>
                                    {entryResult.entry_time}
                                </span>
                            </div>


                            <div className="qr-display">

                                <h4>
                                    Vehicle QR Code
                                </h4>

                                <div className="qr-code-box">
                                    <span>
                                        {entryResult.qr_code}
                                    </span>
                                </div>

                                <p>
                                    Save this QR code for
                                    vehicle exit.
                                </p>

                            </div>

                        </div>

                    )}

                </section>


                {/* =================================================
                    VEHICLE EXIT
                ================================================= */}

                <section className="card">

                    <h2>Vehicle Exit</h2>

                    <p className="description">
                        Exit using the vehicle's QR code or
                        license plate.
                    </p>


                    {/* =================================================
                        QR EXIT
                    ================================================= */}

                    <h3>Exit Using QR</h3>

                    <div className="input-group">

                        <input
                            type="text"
                            placeholder="Enter QR code"
                            value={qrCode}
                            onChange={(event) =>
                                setQrCode(
                                    event.target.value
                                )
                            }
                        />

                        <button
                            onClick={handleQRExit}
                            disabled={exitLoading}
                        >
                            {exitLoading
                                ? "Processing..."
                                : "Exit Using QR"}
                        </button>

                    </div>


                    {/* =================================================
                        PLATE EXIT
                    ================================================= */}

                    <h3>Exit Using Plate</h3>

                    <div className="input-group">

                        <input
                            type="text"
                            placeholder="ABC-1234"
                            value={exitPlate}
                            onChange={(event) =>
                                setExitPlate(
                                    event.target.value
                                )
                            }
                        />

                        <button
                            onClick={handlePlateExit}
                            disabled={exitLoading}
                        >
                            {exitLoading
                                ? "Processing..."
                                : "Exit Using Plate"}
                        </button>

                    </div>


                    {exitError && (
                        <div className="error">
                            {exitError}
                        </div>
                    )}


                    {/* =================================================
                        EXIT RESULT
                    ================================================= */}

                    {exitResult && (

                        <div className="result">

                            <h3>
                                Vehicle Exit Successful
                            </h3>


                            <div className="result-row">
                                <strong>
                                    License Plate:
                                </strong>

                                <span>
                                    {exitResult.license_plate}
                                </span>
                            </div>


                            <div className="result-row">
                                <strong>
                                    Entry Time:
                                </strong>

                                <span>
                                    {exitResult.entry_time}
                                </span>
                            </div>


                            <div className="result-row">
                                <strong>
                                    Exit Time:
                                </strong>

                                <span>
                                    {exitResult.exit_time}
                                </span>
                            </div>


                            <div className="result-row">
                                <strong>
                                    Parking Duration:
                                </strong>

                                <span>
                                    {exitResult.billed_hours}
                                    {" "}hour(s)
                                </span>
                            </div>


                            <div className="result-row amount">
                                <strong>
                                    Amount Owed:
                                </strong>

                                <span>
                                    {exitResult.amount}
                                </span>
                            </div>

                        </div>

                    )}

                </section>

            </main>

        </div>
    );
}

export default App;