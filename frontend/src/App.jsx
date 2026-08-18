import { useEffect, useRef, useState } from "react";

import {
    getParkingSpaces,
    getDetectedPlate,
    registerEntry,
    exitUsingPlate,
} from "./services/api";

import "./App.css";


function App() {

    // ============================================================
    // Detected vehicle
    // ============================================================

    const [detectedPlate, setDetectedPlate] = useState("");

    const [vehicleAction, setVehicleAction] = useState(null);

    /*
     * IMPORTANT:
     * The polling function runs inside a useEffect with [].
     * Therefore it cannot safely rely on the latest React state.
     *
     * This ref always contains the current plate being handled.
     */
    const detectedPlateRef = useRef("");

    /*
     * Stores the plate that has just completed an entry/exit.
     *
     * This prevents the camera from immediately detecting the
     * same vehicle again while it is still in front of the camera.
     */
    const lastCompletedPlateRef = useRef("");


    // ============================================================
    // Entry state
    // ============================================================

    const [selectedSpaceId, setSelectedSpaceId] = useState(null);

    const [entryLoading, setEntryLoading] = useState(false);

    const [entryError, setEntryError] = useState("");

    const [entryResult, setEntryResult] = useState(null);


    // ============================================================
    // Exit state
    // ============================================================

    const [exitLoading, setExitLoading] = useState(false);

    const [exitError, setExitError] = useState("");

    const [exitResult, setExitResult] = useState(null);


    // ============================================================
    // Parking state
    // ============================================================

    const [parkingSpaces, setParkingSpaces] = useState([]);

    const [parkingLoading, setParkingLoading] = useState(false);

    const [parkingError, setParkingError] = useState("");


    // ============================================================
    // Vehicle information stored against parking spaces
    // ============================================================

    const [spaceVehicleInfo, setSpaceVehicleInfo] = useState({});


    // ============================================================
    // Format timestamp
    // ============================================================

    function formatDateTime(value) {

        if (!value) {
            return "Unknown";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return value;
        }

        return date.toLocaleString();
    }


    // ============================================================
    // Get detected license plate
    // ============================================================

    async function checkDetectedPlate() {

        try {

            const result =
                await getDetectedPlate();


            // ----------------------------------------------------
            // Camera currently sees no vehicle
            // ----------------------------------------------------

            if (
                !result.success ||
                !result.license_plate
            ) {

                /*
                 * The camera is no longer seeing a plate.
                 *
                 * This unlocks the previously completed vehicle
                 * so that a future vehicle can be detected normally.
                 */
                lastCompletedPlateRef.current = "";

                return;
            }


            // ----------------------------------------------------
            // Normalize detected plate
            // ----------------------------------------------------

            const plate =
                result.license_plate
                    .trim()
                    .toUpperCase();


            // ----------------------------------------------------
            // Ignore vehicle that just completed a transaction
            // ----------------------------------------------------

            if (
                plate ===
                lastCompletedPlateRef.current
            ) {

                return;
            }


            // ----------------------------------------------------
            // IMPORTANT:
            // A vehicle is already being handled.
            //
            // Use the ref instead of detectedPlate state because
            // this function is running from a polling interval.
            // ----------------------------------------------------

            if (
                detectedPlateRef.current
            ) {

                return;
            }


            // ----------------------------------------------------
            // New vehicle detected
            // ----------------------------------------------------

            detectedPlateRef.current =
                plate;

            setDetectedPlate(plate);

            setVehicleAction(null);

            setSelectedSpaceId(null);

            setEntryError("");

            setExitError("");

            setEntryResult(null);

            setExitResult(null);

        } catch (error) {

            console.error(
                "Could not get detected plate:",
                error
            );
        }
    }


    // ============================================================
    // Get all parking spaces
    // ============================================================

    async function loadParkingSpaces() {

        try {

            setParkingLoading(true);

            setParkingError("");

            const result =
                await getParkingSpaces();


            if (result.success) {

                setParkingSpaces(
                    result.spaces || []
                );

            } else {

                setParkingError(
                    result.error ||
                    "Could not load parking spaces."
                );
            }

        } catch (error) {

            console.error(
                "Could not load parking spaces:",
                error
            );

            setParkingError(
                error.message ||
                "Could not load parking spaces."
            );

        } finally {

            setParkingLoading(false);
        }
    }


    // ============================================================
    // Poll detected plate
    // ============================================================

    useEffect(() => {

        checkDetectedPlate();

        const interval =
            setInterval(() => {

                checkDetectedPlate();

            }, 1000);


        return () => {

            clearInterval(interval);

        };

    }, []);


    // ============================================================
    // Poll parking spaces
    // ============================================================

    useEffect(() => {

        loadParkingSpaces();

        const interval =
            setInterval(() => {

                loadParkingSpaces();

            }, 3000);


        return () => {

            clearInterval(interval);

        };

    }, []);


    // ============================================================
    // Select ENTRY mode
    // ============================================================

    function handleSelectEntry() {

        setVehicleAction("entry");

        setEntryError("");

        setExitError("");

        setEntryResult(null);

        setExitResult(null);
    }


    // ============================================================
    // Select EXIT mode
    // ============================================================

    function handleSelectExit() {

        setVehicleAction("exit");

        setEntryError("");

        setExitError("");

        setEntryResult(null);

        setExitResult(null);

        setSelectedSpaceId(null);
    }


    // ============================================================
    // Select parking space
    // ============================================================

    function handleSpaceSelection(space) {

        if (space.is_occupied) {
            return;
        }

        if (
            entryLoading ||
            exitLoading
        ) {
            return;
        }

        if (vehicleAction !== "entry") {
            return;
        }

        setSelectedSpaceId(space.id);

        setEntryError("");
    }


    // ============================================================
    // Confirm vehicle ENTRY
    // ============================================================

    async function handleConfirmEntry() {

        if (!detectedPlate) {

            setEntryError(
                "No vehicle license plate has been detected."
            );

            return;
        }


        if (!selectedSpaceId) {

            setEntryError(
                "Please select an available parking space."
            );

            return;
        }


        setEntryLoading(true);

        setEntryError("");

        setEntryResult(null);


        try {

            const result =
                await registerEntry(
                    detectedPlate,
                    selectedSpaceId
                );


            if (!result.success) {

                setEntryError(
                    result.error ||
                    "Vehicle entry failed."
                );

                return;
            }


            // ----------------------------------------------------
            // Store entry result
            // ----------------------------------------------------

            const vehicle =
                result.vehicle;


            /*
             * Remember this plate as completed before clearing
             * the active vehicle.
             */
            lastCompletedPlateRef.current ="";


            setEntryResult(vehicle);


            // ----------------------------------------------------
            // Store vehicle information against parking space
            // ----------------------------------------------------

            setSpaceVehicleInfo(
                (previous) => ({
                    ...previous,

                    [selectedSpaceId]: {
                        license_plate:
                            vehicle.license_plate,

                        entry_time:
                            vehicle.entry_time,

                        level:
                            vehicle.level,

                        space:
                            vehicle.space,
                    },
                })
            );


            // ----------------------------------------------------
            // Clear active vehicle
            // ----------------------------------------------------

            detectedPlateRef.current = "";

            setDetectedPlate("");

            setVehicleAction(null);

            setSelectedSpaceId(null);


            // ----------------------------------------------------
            // Refresh parking status
            // ----------------------------------------------------

            await loadParkingSpaces();

        } catch (error) {

            console.error(
                "Vehicle entry error:",
                error
            );

            setEntryError(
                error.message ||
                "Vehicle entry failed."
            );

        } finally {

            setEntryLoading(false);
        }
    }


    // ============================================================
    // Confirm vehicle EXIT
    // ============================================================

    async function handleConfirmExit() {

        if (!detectedPlate) {

            setExitError(
                "No vehicle license plate has been detected."
            );

            return;
        }


        setExitLoading(true);

        setExitError("");

        setExitResult(null);


        try {

            const result =
                await exitUsingPlate(
                    detectedPlate
                );


            if (!result.success) {

                setExitError(
                    result.error ||
                    "Vehicle exit failed."
                );

                return;
            }


            // ----------------------------------------------------
            // Store exit result
            // ----------------------------------------------------

            const vehicle =
                result.vehicle;


            /*
             * Remember the completed plate before clearing the
             * active detected vehicle.
             */
            lastCompletedPlateRef.current =
                detectedPlate;


            setExitResult(vehicle);


            // ----------------------------------------------------
            // Find released parking space
            // ----------------------------------------------------

            const releasedSpace =
                parkingSpaces.find(
                    (space) =>
                        Number(space.level) ===
                            Number(vehicle.level) &&
                        String(space.space) ===
                            String(vehicle.space)
                );


            // ----------------------------------------------------
            // Remove vehicle information from released space
            // ----------------------------------------------------

            if (releasedSpace) {

                setSpaceVehicleInfo(
                    (previous) => {

                        const updated = {
                            ...previous,
                        };

                        delete updated[
                            releasedSpace.id
                        ];

                        return updated;
                    }
                );
            }


            // ----------------------------------------------------
            // Clear active detected vehicle
            // ----------------------------------------------------

            detectedPlateRef.current = "";

            setDetectedPlate("");

            setVehicleAction(null);

            setSelectedSpaceId(null);


            // ----------------------------------------------------
            // Refresh parking status
            // ----------------------------------------------------

            await loadParkingSpaces();

        } catch (error) {

            console.error(
                "Vehicle exit error:",
                error
            );

            setExitError(
                error.message ||
                "Vehicle exit failed."
            );

        } finally {

            setExitLoading(false);
        }
    }


    // ============================================================
    // Cancel current vehicle
    // ============================================================

    function handleCancelDetection() {

        /*
         * Canceling means the vehicle is no longer being handled.
         * Keep the completed-plate protection intact only if this
         * was a completed transaction.
         */

        detectedPlateRef.current = "";

        setDetectedPlate("");

        setVehicleAction(null);

        setSelectedSpaceId(null);

        setEntryError("");

        setExitError("");

        setEntryResult(null);

        setExitResult(null);
    }


    // ============================================================
    // Parking statistics
    // ============================================================

    const totalSpaces =
        parkingSpaces.length;


    const occupiedSpaces =
        parkingSpaces.filter(
            (space) =>
                space.is_occupied
        ).length;


    const availableSpaces =
        totalSpaces -
        occupiedSpaces;


    // ============================================================
    // Selected parking space
    // ============================================================

    const selectedSpace =
        parkingSpaces.find(
            (space) =>
                space.id === selectedSpaceId
        );


    // ============================================================
    // Check whether garage has space
    // ============================================================

    const garageFull =
        totalSpaces > 0 &&
        availableSpaces === 0;


    // ============================================================
    // Render parking level
    // ============================================================

    function renderLevel(level) {

        const spaces =
            parkingSpaces.filter(
                (space) =>
                    Number(space.level) ===
                    Number(level)
            );


        return (

            <div
                className="parking-level"
                key={level}
            >

                <h3>
                    Level {level}
                </h3>


                <div className="parking-grid">

                    {spaces.map((space) => {

                        const isSelected =
                            selectedSpaceId ===
                            space.id;


                        const vehicle =
                            spaceVehicleInfo[
                                space.id
                            ];


                        return (

                            <button
                                key={space.id}
                                type="button"
                                className={
                                    `parking-space ${
                                        space.is_occupied
                                            ? "occupied"
                                            : "available"
                                    } ${
                                        isSelected
                                            ? "selected"
                                            : ""
                                    }`
                                }
                                onClick={() =>
                                    handleSpaceSelection(
                                        space
                                    )
                                }
                                disabled={
                                    space.is_occupied ||
                                    entryLoading ||
                                    exitLoading ||
                                    vehicleAction !== "entry"
                                }
                            >

                                <span className="parking-space-number">
                                    {space.space}
                                </span>


                                {space.is_occupied ? (

                                    vehicle ? (

                                        <div className="parking-space-vehicle">

                                            <strong>
                                                {vehicle.license_plate}
                                            </strong>

                                            <small>
                                                Entry:{" "}
                                                {formatDateTime(
                                                    vehicle.entry_time
                                                )}
                                            </small>

                                        </div>

                                    ) : (

                                        <small>
                                            Occupied
                                        </small>

                                    )

                                ) : (

                                    <small>

                                        {isSelected
                                            ? "Selected"
                                            : "Available"}

                                    </small>

                                )}

                            </button>

                        );

                    })}

                </div>

            </div>
        );
    }


    // ============================================================
    // Vehicle information panel
    // ============================================================

    function renderVehicleInformation() {

        // --------------------------------------------------------
        // EXIT RECEIPT
        // --------------------------------------------------------

        if (exitResult) {

            return (

                <div className="vehicle-info-panel exit-info">

                    <div className="vehicle-info-header">

                        <span>
                            EXIT COMPLETED
                        </span>

                    </div>


                    <h3>
                        {exitResult.license_plate}
                    </h3>


                    <div className="vehicle-info-row">

                        <strong>
                            Entry Time
                        </strong>

                        <span>
                            {formatDateTime(
                                exitResult.entry_time
                            )}
                        </span>

                    </div>


                    <div className="vehicle-info-row">

                        <strong>
                            Exit Time
                        </strong>

                        <span>
                            {formatDateTime(
                                exitResult.exit_time
                            )}
                        </span>

                    </div>


                    <div className="vehicle-info-row">

                        <strong>
                            Duration
                        </strong>

                        <span>
                            {exitResult.duration_hours}
                            {" "}hour(s)
                        </span>

                    </div>


                    <div className="vehicle-info-row">

                        <strong>
                            Parking Space
                        </strong>

                        <span>
                            Level {exitResult.level}
                            {" — "}
                            {exitResult.space}
                        </span>

                    </div>


                    <div className="vehicle-info-amount">

                        <span>
                            Amount Billed
                        </span>

                        <strong>
                            {exitResult.amount}
                        </strong>

                    </div>

                </div>

            );
        }


        // --------------------------------------------------------
        // ENTRY RECEIPT
        // --------------------------------------------------------

        if (entryResult) {

            return (

                <div className="vehicle-info-panel entry-info">

                    <div className="vehicle-info-header">

                        <span>
                            ENTRY COMPLETED
                        </span>

                    </div>


                    <h3>
                        {entryResult.license_plate}
                    </h3>


                    <div className="vehicle-info-row">

                        <strong>
                            Entry Time
                        </strong>

                        <span>
                            {formatDateTime(
                                entryResult.entry_time
                            )}
                        </span>

                    </div>


                    <div className="vehicle-info-row">

                        <strong>
                            Parking Space
                        </strong>

                        <span>
                            Level {entryResult.level}
                            {" — "}
                            {entryResult.space}
                        </span>

                    </div>


                    <div className="vehicle-info-row">

                        <strong>
                            Status
                        </strong>

                        <span>
                            Vehicle Parked
                        </span>

                    </div>

                </div>

            );
        }


        // --------------------------------------------------------
        // CURRENTLY DETECTED VEHICLE
        // --------------------------------------------------------

        if (detectedPlate) {

            return (

                <div className="vehicle-info-panel detected-info">

                    <div className="vehicle-info-header">

                        <span>
                            VEHICLE DETECTED
                        </span>

                    </div>


                    <h3>
                        {detectedPlate}
                    </h3>


                    <div className="vehicle-info-row">

                        <strong>
                            Action
                        </strong>

                        <span>
                            {vehicleAction === "entry"
                                ? "Entry"
                                : vehicleAction === "exit"
                                    ? "Exit"
                                    : "Awaiting selection"}
                        </span>

                    </div>


                    {vehicleAction === "entry" && (

                        <div className="vehicle-info-row">

                            <strong>
                                Parking Space
                            </strong>

                            <span>

                                {selectedSpace
                                    ? `Level ${selectedSpace.level} — ${selectedSpace.space}`
                                    : "Not selected"}

                            </span>

                        </div>

                    )}

                </div>

            );
        }


        // --------------------------------------------------------
        // NOTHING TO SHOW
        // --------------------------------------------------------

        return (

            <div className="vehicle-info-panel empty-info">

                <div className="camera-icon">
                    📷
                </div>

                <strong>
                    No vehicle information
                </strong>

                <p>
                    Vehicle information will appear here
                    when a vehicle is detected.
                </p>

            </div>

        );
    }


    // ============================================================
    // UI
    // ============================================================

    return (

        <div className="app">


            {/* ====================================================
                HEADER
            ==================================================== */}

            <header className="header">

                <div>

                    <h1>
                        Parking Garage
                    </h1>

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

                    <h2>
                        Parking Status
                    </h2>

                    <p className="description">
                        Current parking garage occupancy.
                    </p>


                    {parkingLoading &&
                        parkingSpaces.length === 0 && (

                        <div className="status-message">
                            Loading parking status...
                        </div>

                    )}


                    {parkingError && (

                        <div className="error">
                            {parkingError}
                        </div>

                    )}


                    {parkingSpaces.length > 0 && (

                        <>

                            <div className="parking-summary">

                                <div
                                    className={
                                        `space-status ${
                                            garageFull
                                                ? "unavailable"
                                                : "available"
                                        }`
                                    }
                                >

                                    <span className="status-indicator">
                                        ●
                                    </span>

                                    <div>

                                        <strong>

                                            {garageFull
                                                ? "Parking Full"
                                                : `${availableSpaces} Spaces Available`}

                                        </strong>

                                        <p>

                                            {occupiedSpaces}{" "}
                                            of{" "}
                                            {totalSpaces}{" "}
                                            spaces occupied

                                        </p>

                                    </div>

                                </div>

                            </div>


                            {/* =================================================
                                LEGEND
                            ================================================= */}

                            <div className="parking-legend">

                                <div>

                                    <span className="legend-box available-box"></span>

                                    Available

                                </div>


                                <div>

                                    <span className="legend-box occupied-box"></span>

                                    Occupied

                                </div>


                                <div>

                                    <span className="legend-box selected-box"></span>

                                    Selected

                                </div>

                            </div>


                            {/* =================================================
                                PARKING LEVELS
                            ================================================= */}

                            {renderLevel(1)}

                            {renderLevel(2)}

                        </>

                    )}

                </section>


                {/* =================================================
                    VEHICLE AREA
                ================================================= */}

                <section className="vehicle-section">


                    {/* =================================================
                        ENTRY / EXIT CARD
                    ================================================= */}

                    <section className="card entry-card">

                        <h2>
                            Vehicle Detection
                        </h2>

                        <p className="description">

                            The camera automatically detects the
                            vehicle's license plate.

                        </p>


                        {!detectedPlate && (

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


                        {detectedPlate && (

                            <div className="detected-panel">


                                {/* -----------------------------------------
                                    Plate
                                ----------------------------------------- */}

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

                                    License plate detected automatically.
                                    Select whether the vehicle is entering
                                    or exiting.

                                </p>


                                <div className="plate-display">

                                    <span className="field-label">
                                        Detected License Plate
                                    </span>


                                    <div className="plate-readonly">

                                        {detectedPlate}

                                    </div>

                                </div>


                                {/* =================================================
                                    ACTION SELECTION
                                ================================================= */}

                                {!vehicleAction && (

                                    <div className="action-selection">

                                        <p className="action-title">
                                            What would you like to do?
                                        </p>


                                        <div className="vehicle-action-buttons">

                                            <button
                                                className="confirm-button"
                                                onClick={
                                                    handleSelectEntry
                                                }
                                                disabled={
                                                    garageFull ||
                                                    entryLoading ||
                                                    exitLoading
                                                }
                                            >

                                                {garageFull
                                                    ? "Garage Full"
                                                    : "Entry Vehicle"}

                                            </button>


                                            <button
                                                className="exit-button"
                                                onClick={
                                                    handleSelectExit
                                                }
                                                disabled={
                                                    entryLoading ||
                                                    exitLoading
                                                }
                                            >

                                                Exit Vehicle

                                            </button>

                                        </div>


                                        {garageFull && (

                                            <p className="description">

                                                The garage is currently
                                                full. Entry is unavailable,
                                                but vehicles can still exit.

                                            </p>

                                        )}

                                    </div>

                                )}


                                {/* =================================================
                                    ENTRY MODE
                                ================================================= */}

                                {vehicleAction === "entry" && (

                                    <div className="entry-mode">

                                        <h3>
                                            Select Parking Space
                                        </h3>


                                        <p className="description">

                                            Select an available space
                                            for this vehicle.

                                        </p>


                                        <div className="selected-space-info">

                                            <strong>
                                                Selected Space:
                                            </strong>


                                            <span>

                                                {selectedSpace
                                                    ? `Level ${selectedSpace.level} — ${selectedSpace.space}`
                                                    : "None selected"}

                                            </span>

                                        </div>


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
                                                    entryLoading ||
                                                    !selectedSpaceId
                                                }
                                            >

                                                {entryLoading
                                                    ? "Processing Entry..."
                                                    : "Confirm Entry"}

                                            </button>


                                            <button
                                                className="cancel-button"
                                                onClick={() => {

                                                    setVehicleAction(
                                                        null
                                                    );

                                                    setSelectedSpaceId(
                                                        null
                                                    );

                                                    setEntryError("");

                                                }}
                                                disabled={
                                                    entryLoading
                                                }
                                            >

                                                Back

                                            </button>

                                        </div>

                                    </div>

                                )}


                                {/* =================================================
                                    EXIT MODE
                                ================================================= */}

                                {vehicleAction === "exit" && (

                                    <div className="exit-mode">

                                        <h3>
                                            Exit Vehicle
                                        </h3>


                                        <p className="description">

                                            The detected license plate
                                            will be used to find the
                                            vehicle's active parking
                                            session.

                                        </p>


                                        <div className="exit-plate-confirmation">

                                            <strong>
                                                Exit plate:
                                            </strong>

                                            <span>
                                                {detectedPlate}
                                            </span>

                                        </div>


                                        {exitError && (

                                            <div className="error">
                                                {exitError}
                                            </div>

                                        )}


                                        <div className="confirmation-buttons">

                                            <button
                                                className="exit-button"
                                                onClick={
                                                    handleConfirmExit
                                                }
                                                disabled={
                                                    exitLoading
                                                }
                                            >

                                                {exitLoading
                                                    ? "Processing Exit..."
                                                    : "Confirm Exit"}

                                            </button>


                                            <button
                                                className="cancel-button"
                                                onClick={() => {

                                                    setVehicleAction(
                                                        null
                                                    );

                                                    setExitError("");

                                                }}
                                                disabled={
                                                    exitLoading
                                                }
                                            >

                                                Back

                                            </button>

                                        </div>

                                    </div>

                                )}

                            </div>

                        )}

                    </section>


                    {/* =================================================
                        VEHICLE INFORMATION
                    ================================================= */}

                    <aside className="card vehicle-information-card">

                        <h2>
                            Vehicle Information
                        </h2>

                        <p className="description">
                            Current entry or exit information.
                        </p>

                        {renderVehicleInformation()}

                    </aside>


                </section>


            </main>

        </div>
    );
}


export default App;