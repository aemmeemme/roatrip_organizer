const API = "https://script.google.com/macros/s/AKfycbz5iyIjfDUzSIo3i2qaaISi7Gt3A0NeOJj6lqkQgf7kaKc0dEj6h-KueA_B9aYE4a8H/exec";
    let trip = [];
    let currentTab = "";

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
                        <span>${t.date || ''}</span>
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

    loadData();