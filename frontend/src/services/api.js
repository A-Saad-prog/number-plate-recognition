const API_BASE_URL =
    import.meta.env.VITE_API_BASE_URL ||
    "http://127.0.0.1:8000";


// ============================================================
// Get All Parking Spaces
// ============================================================

export async function getParkingSpaces() {

    const response = await fetch(
        `${API_BASE_URL}/parking/spaces`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get parking spaces: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Get Latest Detected License Plate
// ============================================================

export async function getDetectedPlate() {

    const response = await fetch(
        `${API_BASE_URL}/parking/detected-plate`
    );

    if (!response.ok) {

        throw new Error(
            `Failed to get detected plate: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Register Vehicle Entry
// ============================================================

export async function registerEntry(
    licensePlate,
    parkingSpaceId
) {

    const response = await fetch(
        `${API_BASE_URL}/parking/entry`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                license_plate: licensePlate,
                parking_space_id: parkingSpaceId,
            }),
        }
    );


    if (!response.ok) {

        throw new Error(
            `Failed to register vehicle entry: ${response.status}`
        );

    }

    return await response.json();
}


// ============================================================
// Exit Using License Plate
// ============================================================

export async function exitUsingPlate(
    licensePlate
) {

    const response = await fetch(
        `${API_BASE_URL}/parking/exit`,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
            },

            body: JSON.stringify({
                license_plate: licensePlate,
            }),
        }
    );


    if (!response.ok) {

        throw new Error(
            `Failed to process vehicle exit: ${response.status}`
        );

    }

    return await response.json();
}