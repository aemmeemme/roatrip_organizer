const API = "https://script.google.com/macros/s/AKfycbzI3C5uVjACmpNpS8WP23c-gTlHCIBsa-gALC-cV86hvcpZCJThWiBWX2ZXvJwzC-c3/exec";
let trip = [];
let currentTab = "";
let agendaData = [];
let calendar;

const map = L.map("map").setView([56.5, -4], 7);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

let routingControl, markers = [];

// Initialize Reordering
Sortable.create(document.getElementById('tripBody'), {
    handle: '.drag-handle',
    animation: 150,
    onEnd: () => {
        document.getElementById('saveBtn').style.display = 'block';
        reorderTripLocally();
    }
});

// --- SEARCH / AUTOCOMPLETE LOGIC ---
let autoTimer;
function doAutocomplete(input) {
    clearTimeout(autoTimer);
    const val = input.value;
    if (val.length < 3) return;

    autoTimer = setTimeout(async () => {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5`;
            const r = await fetch(url);
            const d = await r.json();
            const list = document.getElementById("geoList");
            list.innerHTML = "";
            d.forEach(item => {
                const opt = document.createElement("option");
                const cleanAddress = item.display_name.split(',').slice(0,2).join(',');
                opt.value = cleanAddress;
                list.appendChild(opt);
            });
        } catch(e) { console.error("Search error", e); }
    }, 400); // 400ms debounce to save API calls
}

// --- CORE LOGIC ---
async function loadData(tab = "") {
    showLoader(true);
    try {
        const res = await fetch(`${API}?tab=${encodeURIComponent(tab)}`);
        const json = await res.json();
        trip = json.trip;
        agendaData = json.agenda || [];
        currentTab = json.currentTab;

        const sheetSelect = document.getElementById('sheetSelector');
        sheetSelect.innerHTML = json.sheets.map(s => `<option value="${s}" ${s === currentTab ? 'selected' : ''}>${s}</option>`).join('');

        buildDateFilter();
        renderTable();
    } catch(e) { console.error(e); }
    showLoader(false);
}

function buildDateFilter() {
    const dateSelect = document.getElementById('dateFilter');
    const uniqueDates = [...new Set(trip.map(t => formatDateDisplay(t.date)))];
    let html = `<option value="all">Full Itinerary View</option>`;
    uniqueDates.forEach(d => { html += `<option value="${d}">${d}</option>`; });
    dateSelect.innerHTML = html;
}

function formatDateDisplay(rawDate) {
    if (!rawDate) return "";
    const date = new Date(rawDate);
    if (isNaN(date.getTime())) return rawDate;
    const weekdays = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
    return `${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()} [${weekdays[date.getDay()]}]`;
}

function renderTable() {
    const tbody = document.getElementById("tripBody");
    tbody.innerHTML = "";
    const filterVal = document.getElementById('dateFilter').value;
    const visibleStops = trip.filter(t => filterVal === "all" || formatDateDisplay(t.date) === filterVal);

    visibleStops.forEach((t, i) => {
        const tr = document.createElement("tr");
        tr.dataset.index = i;
        tr.innerHTML = `
            <td><span class="drag-handle">☰</span></td>
            <td>
                <strong>${t.from.split(',')[0]} → ${t.to.split(',')[0]}</strong>
                <div class="route-info">
                    <span>${t.km || '--'} km</span>
                    <span>${t.hrs || ''}</span>
                    <span>${formatDateDisplay(t.date) || ''}</span>
                </div>
            </td>
            <td>
                <div class="time-badge">Dep: ${t.dep || '09:00'}</div>
                <div class="time-badge" style="background:#059669; margin-top:2px">Arr: ${t.arr || '--:--'}</div>
            </td>
            <td><button onclick="deleteRow(${tr.dataset.index})" style="color:red; border:none; background:none; cursor:pointer">✕</button></td>
        `;
        tbody.appendChild(tr);
    });
    updateMap(visibleStops);
}

function updateMap(visibleStops) {
    if (routingControl) map.removeControl(routingControl);
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    let waypoints = [];

    visibleStops.forEach(t => {
        if (t.fromLat) {
            const p = L.latLng(t.fromLat, t.fromLon);
            markers.push(L.circleMarker(p, {radius:6, color:'#3b82f6', fillOpacity:0.8}).addTo(map).bindPopup(t.from));
            waypoints.push(p);
        }
        if (t.toLat) {
            const p = L.latLng(t.toLat, t.toLon);
            markers.push(L.circleMarker(p, {radius:6, color:'#10b981', fillOpacity:0.8}).addTo(map).bindPopup(t.to));
            waypoints.push(p);
        }
    });

    if (waypoints.length > 1) {
        routingControl = L.Routing.control({
            waypoints: waypoints,
            lineOptions: { styles: [{ color: '#3b82f6', opacity: 0.8, weight: 6 }] },
            createMarker: () => null,
            addWaypoints: false,
            draggableWaypoints: false,
            show: false
        }).addTo(map);
        map.fitBounds(new L.featureGroup(markers).getBounds().pad(0.2));
    }
}

function reorderTripLocally() {
    const rows = Array.from(document.querySelectorAll('#tripBody tr'));
    trip = rows.map(row => trip[row.dataset.index]);
    updateMap(trip);
}

async function saveChanges() {
    showLoader(true);
    await fetch(API, {
        method: "POST",
        body: JSON.stringify({ action: "saveAll", tab: currentTab, data: trip })
    });
    document.getElementById('saveBtn').style.display = 'none';
    loadData(currentTab);
}

async function handleAdd() {
    const data = {
        action: "add",
        tab: currentTab,
        date: document.getElementById('newDate').value,
        dep: document.getElementById('newDep').value,
        from: document.getElementById('newFrom').value,
        to: document.getElementById('newTo').value
    };
    showLoader(true);
    await fetch(API, { method: "POST", body: JSON.stringify(data) });
    document.getElementById('newFrom').value = "";
    document.getElementById('newTo').value = "";
    loadData(currentTab);
}

function createNewTab() {
    const name = prompt("Enter Trip Name:");
    if (!name) return;
    showLoader(true);
    fetch(API, {
        method: "POST",
        body: JSON.stringify({ action: "createSheet", tab: name })
    }).then(() => loadData(name));
}

/**
 * Delete a specific row from the Google Sheet
 * @param {number} rowId - The ID (row number) provided by the Google Script
 */
async function deleteRow(rowId) {
    if (!confirm("Are you sure you want to remove this stop from the itinerary?")) return;

    showLoader(true);
    try {
        console.log("Tryin to delete row: ", rowId);
        const response = await fetch(API, {
            method: "POST",
            body: JSON.stringify({
                action: "delete",
                tab: currentTab,
                id: rowId
            })
        });

        if (response.ok) {
            // Refresh the data to show the updated list
            await loadData(currentTab);
        } else {
            alert("Error deleting the row.");
        }
    } catch (e) {
        console.error("Delete error:", e);
        alert("Connection error while trying to delete.");
    }
    finally{
        showLoader(false);
        loadData(currentTab);
    }
}

function changeTab() { loadData(document.getElementById('sheetSelector').value); }
function showLoader(s) { document.getElementById('loader').style.display = s ? 'flex' : 'none'; }


function switchMode(mode) {
    const isStd = mode === 'standard';
    document.getElementById('standardView').style.display = isStd ? 'contents' : 'none';
    document.getElementById('agendaView').style.display = isStd ? 'none' : 'block';

    document.getElementById('btnStd').classList.toggle('active', isStd);
    document.getElementById('btnAgd').classList.toggle('active', !isStd);

    if (!isStd) initCalendar();
}

function initCalendar() {
    const calendarEl = document.getElementById('calendar');

    // SAFE DATE PARSING: Find first day of trip without UTC shifting
    const sortedDates = trip.map(t => t.date).sort();
    const initialDate = sortedDates.length > 0 ? sortedDates[0].split('T')[0] : new Date().toISOString().split('T')[0];

    if (calendar) calendar.destroy();
    console.log("Agenda data:\n", agendaData)
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        initialDate: initialDate,
        headerToolbar: { left: 'prev,next', center: 'title', right: '' },
        titleFormat: { year: 'numeric', month: 'short' },
        slotLabelFormat: {hour: '2-digit',   minute: '2-digit', hour12: false},
        dayHeaderFormat: {weekday: 'short', day: 'numeric', omitCommas: true },
        firstDay: 1, // starting from monday

        slotMinTime: '00:00:00',
        slotMaxTime: '24:00:00',
        allDaySlot: false,
        height: '100%',

        editable: true,
        selectable: true,
        events: agendaData.map(a => ({
            id: a.id,
            title: `${a.booked === 'Y' ? '✅' : '⏳'} ${a.city}: ${a.title} (${a.price}€)`,
            start: `${a.date.split('T')[0]}T${a.start}`,
            end: `${a.date.split('T')[0]}T${a.end}`,
            className: 'cat-' + a.category
        })),

        // ADD NEW EVENT
        select: function(info) {
            console.log(info)
            currentSelectedInfo = info;
            openModal(false, currentSelectedInfo);
        },

        // EDIT EVENT
        eventClick: function(info) {
            const eventObj = agendaData.find(a => a.id == info.event.id);
            if (eventObj) {
                console.log(eventObj)
                console.log(info.event.start)
                currentSelectedInfo = info
                openModal(true, eventObj);
            }
        },
         // DRAG AND DROP
        eventChange: async function(info) {
            const idx = agendaData.findIndex(a => a.id == info.event.id);
            if (idx > -1) {
                // Use the naive helper to avoid the -1 day jump
                agendaData[idx].start = info.event.startStr.split('T')[1].substring(0,5);
                agendaData[idx].end = info.event.endStr.split('T')[1].substring(0,5);
                await saveAgenda();
            }
        }
    });
    calendar.render();
}

async function saveAgenda() {
    showLoader(true);
    await fetch(API, {
        method: "POST",
        body: JSON.stringify({ action: "saveAgenda", tab: currentTab, data: agendaData })
    });
    showLoader(false);
}

function openModal(isEdit, data = null) {
    const modal = document.getElementById('eventModal');
    modal.style.display = 'flex';

    document.getElementById('modalTitle').innerText = isEdit ? "Edit Activity" : "Add Activity";
    document.getElementById('deleteEventBtn').style.display = isEdit ? "block" : "none";

    if (isEdit) {
        document.getElementById('editEventId').value = data.id;
        document.getElementById('eventTitle').value = data.title;
        document.getElementById('eventCity').value = data.city;
        document.getElementById('eventCat').value = data.category;
        document.getElementById('eventPrice').value = data.price;
        document.getElementById('eventBooked').value = data.booked;
        document.getElementById('eventStart').value = data.start;
        document.getElementById('eventEnd').value = data.end;
    } else {
        document.getElementById('editEventId').value = "";
        document.getElementById('eventTitle').value = "";
        document.getElementById('eventCity').value = "";
        document.getElementById('eventPrice').value = 0;
        // Autofill times from calendar selection
        document.getElementById('eventStart').value = currentSelectedInfo.startStr;
        document.getElementById('eventEnd').value = currentSelectedInfo.endStr;
    }
}

function closeModal() {
    document.getElementById('eventModal').style.display = 'none';
}

async function handleSaveEvent() {
    const id = document.getElementById('editEventId').value;
    const entry = {
        date: currentSelectedInfo.startStr.split('T')[0],
        start: document.getElementById('eventStart').value,
        end: document.getElementById('eventEnd').value,
        city: document.getElementById('eventCity').value,
        title: document.getElementById('eventTitle').value,
        price: document.getElementById('eventPrice').value,
        booked: document.getElementById('eventBooked').value,
        category: document.getElementById('eventCat').value
    };

    if (id) {
        const idx = agendaData.findIndex(a => a.id == id);
        agendaData[idx] = { ...entry, id: id };
    } else {
        agendaData.push(entry);
    }

    closeModal();
    await saveAgenda();
    loadData(currentTab); // Full refresh to ensure IDs from Sheet are synced
}

async function handleDeleteEvent() {
    const id = document.getElementById('editEventId').value;
    if (confirm("Remove this activity?")) {
        agendaData = agendaData.filter(a => a.id != id);
        closeModal();
        await saveAgenda();
        loadData(currentTab);
    }
}


loadData();