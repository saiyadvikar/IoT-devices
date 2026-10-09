// Sankalp ANC IoT Dashboard - Interactivity and Visualizations
// Processes raw data dynamically based on filters, manages Chart.js instances, and theme switching

document.addEventListener("DOMContentLoaded", () => {
    try {
    // ----------------------------------------------------------------------
    // INITIALIZATION SECURITY CHECKS
    // ----------------------------------------------------------------------
    if (typeof dashboardData === "undefined") {
        const errorMsg = "Error: dashboard_data.js could not be loaded. Please ensure dashboard_data.js and dashboard.js are in the same folder as index.html.";
        console.error(errorMsg);
        alert(errorMsg);
        return;
    }

    // ----------------------------------------------------------------------
    // STATE VARIABLES
    // ----------------------------------------------------------------------
    let currentMonth = "All";
    let currentBlock = "All";
    let subcentreSearchQuery = "";
    
    // Chart instances storage
    let charts = {
        blockPie: null,
        weeklyRisks: null,
        blockRisks: null,
        blockUtilization: null
    };

    function formatDateToMDY(dateStr) {
        if (!dateStr) return "";
        const parts = dateStr.split("-");
        if (parts.length !== 3) return dateStr;
        const year = parts[0];
        const month = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        return `${month}/${day}/${year}`;
    }

    // Week boundaries (Friday to Thursday, generated dynamically from the data)
    const WEEKS = dashboardData.weeks || [];

    // Theme Config
    const htmlEl = document.documentElement;
    const themeToggleBtn = document.getElementById("theme-toggle");
    const themeIcon = document.getElementById("theme-icon");

    // Initialize Theme safely (file:// mode sometimes blocks localStorage access)
    let savedTheme = "dark";
    try {
        savedTheme = localStorage.getItem("sankalp-theme") || "dark";
    } catch (e) {
        console.warn("localStorage is blocked or unavailable. Defaulting to dark theme.", e);
    }
    htmlEl.setAttribute("data-theme", savedTheme);
    updateThemeIcon(savedTheme);

    // ----------------------------------------------------------------------
    // DOM ELEMENTS
    // ----------------------------------------------------------------------
    const monthFilterSelect = document.getElementById("month-filter");
    const blockFilterSelect = document.getElementById("block-filter");
    const exportCsvBtn = document.getElementById("export-csv-btn");
    const lastUpdatedBadge = document.getElementById("last-updated-badge");
    
    const kpiTotalContacts = document.getElementById("kpi-total-contacts");
    const kpiTotalContactsSub = document.getElementById("kpi-total-contacts-sub");
    const kpiWeightRate = document.getElementById("kpi-weight-rate");
    const kpiWeightRateSub = document.getElementById("kpi-weight-rate-sub");
    const kpiBpRate = document.getElementById("kpi-bp-rate");
    const kpiBpRateSub = document.getElementById("kpi-bp-rate-sub");
    const kpiUnderweight = document.getElementById("kpi-underweight");
    const kpiPih = document.getElementById("kpi-pih");

    const subcentreSearch = document.getElementById("subcentre-search");
    const subcentreTableBody = document.getElementById("subcentres-table-body");
    const weeklyTableBody = document.getElementById("weekly-table-body");
    const downloadWeeklyBtn = document.getElementById("download-weekly-btn");
    const downloadSubcentreBtn = document.getElementById("download-subcentre-btn");
    const downloadUtilizationChartBtn = document.getElementById("download-utilization-chart-btn");
    const downloadMonthlyTrendBtn = document.getElementById("download-monthly-trend-btn");
    
    // Modal Elements
    const detailModal = document.getElementById("detail-modal");
    const modalCloseBtn = document.getElementById("modal-close-btn");
    const modalTitle = document.getElementById("modal-title");
    const modalSubtitle = document.getElementById("modal-subtitle");
    const modalKpiContacts = document.getElementById("modal-kpi-contacts");
    const modalKpiIotRate = document.getElementById("modal-kpi-iot-rate");
    const modalRiskPih = document.getElementById("modal-risk-pih");
    const modalRiskUnderweight = document.getElementById("modal-risk-underweight");
    const modalAnmsList = document.getElementById("modal-anms-list");



    // ----------------------------------------------------------------------
    // THEME SWITCHER LOGIC
    // ----------------------------------------------------------------------
    themeToggleBtn.addEventListener("click", () => {
        const currentTheme = htmlEl.getAttribute("data-theme");
        const newTheme = currentTheme === "dark" ? "light" : "dark";
        htmlEl.setAttribute("data-theme", newTheme);
        try {
            localStorage.setItem("sankalp-theme", newTheme);
        } catch (e) {
            console.warn("localStorage is blocked. Theme preference will not persist.", e);
        }
        updateThemeIcon(newTheme);
        
        // Rebuild charts to adjust grids/text colors
        updateChartDefaults();
        renderCharts();
    });

    function updateThemeIcon(theme) {
        if (theme === "dark") {
            themeIcon.className = "fa-solid fa-sun";
            themeToggleBtn.title = "Switch to Light Mode";
        } else {
            themeIcon.className = "fa-solid fa-moon";
            themeToggleBtn.title = "Switch to Dark Mode";
        }
    }

    // Chart.js Theme Defaults
    function updateChartDefaults() {
        if (typeof Chart === "undefined") {
            console.warn("Chart.js is not loaded. Skipping style configuration.");
            return;
        }
        const isDark = htmlEl.getAttribute("data-theme") === "dark";
        const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 23, 42, 0.06)";
        const textColor = isDark ? "#94a3b8" : "#64748b";
        const tooltipBg = isDark ? "#0f172a" : "#ffffff";
        const tooltipBorder = isDark ? "#334155" : "#e2e8f0";
        const tooltipText = isDark ? "#f8fafc" : "#1e293b";

        Chart.defaults.color = textColor;
        Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
        Chart.defaults.font.size = 11;
        Chart.defaults.font.weight = 500;
        
        Chart.defaults.plugins.tooltip.backgroundColor = tooltipBg;
        Chart.defaults.plugins.tooltip.borderColor = tooltipBorder;
        Chart.defaults.plugins.tooltip.borderWidth = 1;
        Chart.defaults.plugins.tooltip.titleColor = tooltipText;
        Chart.defaults.plugins.tooltip.bodyColor = textColor;
        Chart.defaults.plugins.tooltip.cornerRadius = 8;
        Chart.defaults.plugins.tooltip.padding = 10;
        
        if (Chart.defaults.scale && Chart.defaults.scale.grid) {
            Chart.defaults.scale.grid.color = gridColor;
        } else {
            Chart.defaults.scale = Chart.defaults.scale || {};
            Chart.defaults.scale.grid = { color: gridColor };
        }
    }

    // ----------------------------------------------------------------------
    // FILTER AND BINDINGS CONTROLS
    // ----------------------------------------------------------------------
    monthFilterSelect.addEventListener("change", (e) => {
        currentMonth = e.target.value;
        processAndRefresh();
    });

    blockFilterSelect.addEventListener("change", (e) => {
        currentBlock = e.target.value;
        processAndRefresh();
    });

    subcentreSearch.addEventListener("input", (e) => {
        subcentreSearchQuery = e.target.value.toLowerCase();
        renderSubcentresTable();
    });



    // ----------------------------------------------------------------------
    // CORE PROCESSING ENGINE
    // ----------------------------------------------------------------------
    let filteredRecords = [];
    let filteredOverall = [];
    let weeklySummary = [];
    let subcentresSummary = [];
    let blocksSummary = [];

    function processAndRefresh() {
        // 1. Filter raw records (IoT syncs)
        filteredRecords = dashboardData.records.filter(r => {
            const matchesMonth = currentMonth === "All" || r.month === currentMonth;
            const matchesBlock = currentBlock === "All" || r.block === currentBlock;
            return matchesMonth && matchesBlock;
        });

        // 1b. Filter overall registers
        filteredOverall = (dashboardData.overall_visits || []).filter(v => {
            const matchesMonth = currentMonth === "All" || v.month === currentMonth;
            const matchesBlock = currentBlock === "All" || v.block === currentBlock;
            return matchesMonth && matchesBlock;
        });

        // 2. Compute Weekly Summary based on the filtered selection
        weeklySummary = WEEKS.map(w => {
            // Filter IoT records falling inside this week range
            const weekRecs = filteredRecords.filter(r => r.anc_date && r.anc_date >= w.start && r.anc_date <= w.end);
            
            // Filter overall register checkups falling inside this week range
            const weekOverall = filteredOverall.filter(v => v.date >= w.start && v.date <= w.end);
            
            let totalContacts = weekOverall.length;
            
            // IoT report records in this week
            const iotRecs = weekRecs.filter(r => r.has_iot);
            const beingUsed = new Set(iotRecs.map(r => r.sub_facility)).size;
            const iotDevicesUsed = new Set(iotRecs.map(r => r.anm_id).filter(id => id)).size;
            
            // Safeguard: total overall checkups cannot be less than actual IoT checkups
            if (totalContacts < weekRecs.length) {
                totalContacts = weekRecs.length;
            }
            
            // Device usage counts (checkup-level)
            const weighingScaleUsed = weekRecs.filter(r => r.weight_iot !== null).length;
            const bpMachineUsed = weekRecs.filter(r => r.bp_sys_iot !== null).length;
            
            const pih = weekRecs.filter(r => r.is_pih).length;
            const weightUnder = weekRecs.filter(r => r.is_underweight).length;

            const weightUtilRate = totalContacts > 0 ? (weighingScaleUsed / totalContacts) * 100 : 0;
            const bpUtilRate = totalContacts > 0 ? (bpMachineUsed / totalContacts) * 100 : 0;

            return {
                week_no: w.no,
                date_from: w.start,
                date_to: w.end,
                label: w.label,
                total_distributed: w.devices,
                being_used: beingUsed,
                total_anc_contacts: totalContacts,
                iot_devices_used: iotDevicesUsed,
                weighing_scale_used: weighingScaleUsed,
                weight_util_rate: weightUtilRate,
                bp_machine_used: bpMachineUsed,
                bp_util_rate: bpUtilRate,
                pih: pih,
                weight_under: weightUnder
            };
        });

        // 3. Compute Subcentres Summary based on selection
        const subcentresMap = {};
        
        // Initialize subcentres from equipped list
        (dashboardData.subcentres || []).forEach(s => {
            const matchesBlock = currentBlock === "All" || s.block === currentBlock;
            if (matchesBlock) {
                subcentresMap[s.name] = {
                    name: s.name,
                    block: s.block,
                    facility: s.facility,
                    anm_name: s.anm_name || "",
                    contacts: 0,
                    iot_contacts: 0,
                    weight_contacts: 0,
                    bp_contacts: 0,
                    pih: 0,
                    underweight: 0,
                    anms: new Set()
                };
            }
        });

        // Fill overall contacts from filtered overall visits
        filteredOverall.forEach(v => {
            const s = v.subcentre;
            if (subcentresMap[s]) {
                subcentresMap[s].contacts += 1;
            }
        });

        // Fill IoT data from filtered IoT records
        filteredRecords.forEach(r => {
            const s = r.sub_facility;
            if (subcentresMap[s]) {
                subcentresMap[s].iot_contacts += 1;
                if (r.weight_iot !== null) subcentresMap[s].weight_contacts += 1;
                if (r.bp_sys_iot !== null) subcentresMap[s].bp_contacts += 1;
                if (r.is_pih) subcentresMap[s].pih += 1;
                if (r.is_underweight) subcentresMap[s].underweight += 1;
                if (r.user_name) subcentresMap[s].anms.add(r.user_name);
            }
        });

        subcentresSummary = Object.values(subcentresMap).map(s => {
            s.anms = Array.from(s.anms);
            s.display_anm = s.anms.length > 0 ? s.anms.join(", ") : (s.anm_name || "-");
            if (s.contacts < s.iot_contacts) {
                s.contacts = s.iot_contacts;
            }
            s.iot_rate = s.contacts > 0 ? (s.iot_contacts / s.contacts) * 100 : 0;
            s.weight_rate = s.contacts > 0 ? (s.weight_contacts / s.contacts) * 100 : 0;
            s.bp_rate = s.contacts > 0 ? (s.bp_contacts / s.contacts) * 100 : 0;
            return s;
        });

        // 4. Compute Blocks Summary based on selection
        const blocksMap = {};
        subcentresSummary.forEach(s => {
            const b = s.block;
            if (!blocksMap[b]) {
                blocksMap[b] = {
                    name: b,
                    contacts: 0,
                    iot_contacts: 0,
                    weight_contacts: 0,
                    bp_contacts: 0,
                    pih: 0,
                    underweight: 0,
                    sessions: 0
                };
            }
            blocksMap[b].contacts += s.contacts;
            blocksMap[b].iot_contacts += s.iot_contacts;
            blocksMap[b].weight_contacts += s.weight_contacts;
            blocksMap[b].bp_contacts += s.bp_contacts;
            blocksMap[b].pih += s.pih;
            blocksMap[b].underweight += s.underweight;
        });

        // Compute session counts from filtered records (since session is an IoT visit day)
        const blockSessions = {};
        filteredRecords.forEach(r => {
            const b = r.block;
            if (r.anc_date && r.sub_facility) {
                if (!blockSessions[b]) blockSessions[b] = new Set();
                blockSessions[b].add(r.anc_date + "|" + r.sub_facility);
            }
        });

        blocksSummary = Object.values(blocksMap).map(b => {
            b.session_count = blockSessions[b.name] ? blockSessions[b.name].size : 0;
            b.iot_rate = b.contacts > 0 ? (b.iot_contacts / b.contacts) * 100 : 0;
            b.weight_rate = b.contacts > 0 ? (b.weight_contacts / b.contacts) * 100 : 0;
            b.bp_rate = b.contacts > 0 ? (b.bp_contacts / b.contacts) * 100 : 0;
            return b;
        });

        // 5. Update UI
        updateKPIs();
        renderWeeklyTable();
        renderSubcentresTable();
        renderCharts();
    }

    // ----------------------------------------------------------------------
    // RENDER KPIS
    // ----------------------------------------------------------------------
    function updateKPIs() {
        const totalIot = filteredRecords.length;
        const totalOverall = filteredOverall.length;
        const totalDenominator = totalOverall < totalIot ? totalIot : totalOverall;
        
        const weightSyncs = filteredRecords.filter(r => r.weight_iot !== null).length;
        const bpSyncs = filteredRecords.filter(r => r.bp_sys_iot !== null).length;
        const underweight = filteredRecords.filter(r => r.is_underweight).length;
        const pih = filteredRecords.filter(r => r.is_pih).length;
        
        const weightRate = totalDenominator > 0 ? (weightSyncs / totalDenominator) * 100 : 0;
        const bpRate = totalDenominator > 0 ? (bpSyncs / totalDenominator) * 100 : 0;

        kpiTotalContacts.innerText = totalDenominator.toLocaleString();
        
        // Show month context on contacts subtext
        if (currentMonth !== "All") {
            kpiTotalContactsSub.innerText = `Consultations in ${currentMonth}`;
        } else {
            const monthsOrdered = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const uniqueMonths = [...new Set(dashboardData.records.map(r => r.month))].filter(Boolean);
            uniqueMonths.sort((a, b) => monthsOrdered.indexOf(a) - monthsOrdered.indexOf(b));
            const rangeStr = uniqueMonths.length > 1 ? `${uniqueMonths[0]} - ${uniqueMonths[uniqueMonths.length - 1]}` : (uniqueMonths[0] || "");
            kpiTotalContactsSub.innerText = `Consultations overall (${rangeStr})`;
        }

        kpiWeightRate.innerText = `${weightRate.toFixed(1)}%`;
        kpiWeightRateSub.innerText = `${weightSyncs} of ${totalDenominator} checkups`;

        kpiBpRate.innerText = `${bpRate.toFixed(1)}%`;
        kpiBpRateSub.innerText = `${bpSyncs} of ${totalDenominator} checkups`;

        kpiUnderweight.innerText = underweight.toLocaleString();
        kpiPih.innerText = pih.toLocaleString();
    }

    // ----------------------------------------------------------------------
    // RENDER DATA TABLES
    // ----------------------------------------------------------------------
    function renderWeeklyTable() {
        weeklyTableBody.innerHTML = "";
        weeklySummary.forEach(w => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>Week ${w.week_no}</strong></td>
                <td>${formatDateToMDY(w.date_from)}</td>
                <td>${formatDateToMDY(w.date_to)}</td>
                <td><span class="badge badge-primary">${w.total_distributed}</span></td>
                <td><span class="badge badge-primary">${w.being_used}</span></td>
                <td>${w.total_anc_contacts}</td>
                <td><span class="badge badge-success">${w.weighing_scale_used}</span></td>
                <td><span class="badge badge-success">${w.bp_machine_used}</span></td>
                <td>${w.pih > 0 ? `<span class="badge badge-warning">${w.pih}</span>` : '0'}</td>
                <td>${w.weight_under > 0 ? `<span class="badge badge-pink">${w.weight_under}</span>` : '0'}</td>
            `;
            weeklyTableBody.appendChild(tr);
        });
    }

    function renderSubcentresTable() {
        subcentreTableBody.innerHTML = "";
        
        // Filter subcentres by search query (supports subcentre, block, and ANM name)
        const filteredSub = subcentresSummary.filter(s => {
            const anm = (s.display_anm || s.anm_name || "").toLowerCase();
            return s.name.toLowerCase().includes(subcentreSearchQuery) || 
                   s.block.toLowerCase().includes(subcentreSearchQuery) ||
                   anm.includes(subcentreSearchQuery);
        });

        // Sort by total IoT utilization rate ascending (poor performance first)
        filteredSub.sort((a, b) => a.iot_rate - b.iot_rate);

        if (filteredSub.length === 0) {
            subcentreTableBody.innerHTML = `
                <tr>
                    <td colspan="11" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                        <i class="fa-solid fa-face-frown" style="font-size: 1.5rem; margin-bottom: 0.5rem; display: block;"></i>
                        No subcentres found matching your search.
                    </td>
                </tr>
            `;
            return;
        }

        filteredSub.forEach(s => {
            const tr = document.createElement("tr");
            const anmName = s.display_anm || s.anm_name || (s.anms && s.anms.length > 0 ? s.anms.join(", ") : "-");
            tr.innerHTML = `
                <td style="text-align: center;"><strong>${s.block}</strong></td>
                <td style="text-align: center;"><strong>${s.name}</strong></td>
                <td style="text-align: center;">${anmName}</td>
                <td style="text-align: center;">${s.contacts}</td>
                <td style="text-align: center;">${s.weight_contacts}</td>
                <td style="text-align: center;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <span style="font-weight: 700; width: 34px; text-align: right;">${s.weight_rate.toFixed(0)}%</span>
                        <div style="height: 6px; background-color: var(--border-color); border-radius: var(--radius-full); overflow: hidden; width: 42px;">
                            <div style="width: ${s.weight_rate}%; height: 100%; background: linear-gradient(95deg, var(--color-primary), var(--color-pink)); border-radius: var(--radius-full);"></div>
                        </div>
                    </div>
                </td>
                <td style="text-align: center;">${s.bp_contacts}</td>
                <td style="text-align: center;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <span style="font-weight: 700; width: 34px; text-align: right;">${s.bp_rate.toFixed(0)}%</span>
                        <div style="height: 6px; background-color: var(--border-color); border-radius: var(--radius-full); overflow: hidden; width: 42px;">
                            <div style="width: ${s.bp_rate}%; height: 100%; background: linear-gradient(95deg, var(--color-secondary), var(--color-success)); border-radius: var(--radius-full);"></div>
                        </div>
                    </div>
                </td>
                <td style="text-align: center;">${s.pih > 0 ? `<span class="badge badge-warning">${s.pih}</span>` : '0'}</td>
                <td style="text-align: center;">${s.underweight > 0 ? `<span class="badge badge-pink">${s.underweight}</span>` : '0'}</td>
                <td style="text-align: center;">
                    <button class="btn btn-outline btn-sm view-details-btn" data-sub="${s.name}" style="padding: 4px 10px; font-size: 0.75rem;">
                        <i class="fa-solid fa-eye"></i> Details
                    </button>
                </td>
            `;
            subcentreTableBody.appendChild(tr);
        });

        // Bind Detail Buttons
        subcentreTableBody.querySelectorAll(".view-details-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                showSubcentreModal(btn.dataset.sub);
            });
        });
    }

    // ----------------------------------------------------------------------
    // SUBCENTRE MODAL DETAILS
    // ----------------------------------------------------------------------
    function showSubcentreModal(name) {
        const s = subcentresSummary.find(item => item.name === name);
        if (!s) return;

        modalTitle.innerText = s.name;
        modalSubtitle.innerText = `Block: ${s.block} | Facility: ${s.facility}`;
        
        modalKpiContacts.innerText = s.contacts;
        modalKpiIotRate.innerText = `${s.iot_rate.toFixed(1)}%`;
        
        modalRiskPih.innerText = `${s.pih} case${s.pih !== 1 ? 's' : ''}`;
        modalRiskPih.className = s.pih > 0 ? "badge badge-warning" : "badge badge-success";

        modalRiskUnderweight.innerText = `${s.underweight} case${s.underweight !== 1 ? 's' : ''}`;
        modalRiskUnderweight.className = s.underweight > 0 ? "badge badge-pink" : "badge badge-success";



        if (s.anms && s.anms.length > 0) {
            modalAnmsList.innerHTML = `<ul style="padding-left: 1.2rem; margin-top: 4px;">
                ${s.anms.map(anm => `<li style="margin-bottom: 2px;">${anm}</li>`).join('')}
            </ul>`;
        } else {
            modalAnmsList.innerText = "No assigned ANM details found.";
        }

        detailModal.style.display = "flex";
    }

    modalCloseBtn.addEventListener("click", () => {
        detailModal.style.display = "none";
    });

    window.addEventListener("click", (e) => {
        if (e.target === detailModal) {
            detailModal.style.display = "none";
        }
    });

    // ----------------------------------------------------------------------
    // VISUALIZATIONS GENERATOR (CHART.JS)
    // ----------------------------------------------------------------------
    function renderCharts() {
        if (typeof Chart === "undefined") {
            console.warn("Chart.js is not loaded. Skipping chart rendering.");
            return;
        }
        renderMonthlyUtilizationChart();
        renderBlockUtilizationChart();
        renderBlockPieChart();
        renderBlockRisksChart();
    }



    // Chart 2: Block Pie Chart
    function renderBlockPieChart() {
        if (charts.blockPie) {
            charts.blockPie.destroy();
        }

        const ctx = document.getElementById("block-pie-chart").getContext("2d");
        const labels = blocksSummary.map(b => b.name);
        const data = blocksSummary.map(b => b.session_count);

        // Curated colors for blocks
        const colors = [
            'rgba(99, 102, 241, 0.85)', // Indigo
            'rgba(14, 165, 233, 0.85)', // Sky
            'rgba(236, 72, 153, 0.85)'  // Pink
        ];
        
        const borderColors = [
            'rgb(99, 102, 241)',
            'rgb(14, 165, 233)',
            'rgb(236, 72, 153)'
        ];

        charts.blockPie = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors.slice(0, labels.length),
                    borderColor: borderColors.slice(0, labels.length),
                    borderWidth: 1.5,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 10, padding: 15 }
                    }
                }
            }
        });
    }

    // Chart 5: Block-wise IoT Utilization Rate
    function renderBlockUtilizationChart() {
        if (charts.blockUtilization) {
            charts.blockUtilization.destroy();
        }

        const ctx = document.getElementById("block-utilization-chart").getContext("2d");
        const labels = blocksSummary.map(b => b.name);
        const weightData = blocksSummary.map(b => b.weight_rate);
        const bpData = blocksSummary.map(b => b.bp_rate);

        charts.blockUtilization = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Weighing Scale Util. (%)',
                        data: weightData,
                        backgroundColor: 'rgba(99, 102, 241, 0.75)',
                        borderColor: 'rgb(99, 102, 241)',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        barPercentage: 0.7,
                        categoryPercentage: 0.6
                    },
                    {
                        label: 'BP Machine Util. (%)',
                        data: bpData,
                        backgroundColor: 'rgba(14, 165, 233, 0.75)',
                        borderColor: 'rgb(14, 165, 233)',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        barPercentage: 0.7,
                        categoryPercentage: 0.6
                    }
                ]
            },
            plugins: [{
                id: 'datalabels',
                afterDraw: (chart) => {
                    const ctx = chart.ctx;
                    chart.data.datasets.forEach((dataset, i) => {
                        const meta = chart.getDatasetMeta(i);
                        meta.data.forEach((bar, index) => {
                            const data = dataset.data[index];
                            if (data === null || data === undefined) return;
                            const valStr = data.toFixed(1) + '%';
                            const isDark = document.documentElement.getAttribute("data-theme") === "dark";
                            ctx.fillStyle = isDark ? '#f8fafc' : '#1e293b';
                            ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';
                            // Position the text slightly above the bar
                            const x = bar.x;
                            const y = bar.y - 5;
                            ctx.fillText(valStr, x, y);
                        });
                    });
                }
            }],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, usePointStyle: true }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 115,
                        title: { display: true, text: 'Utilization Rate (%)' }
                    }
                }
            }
        });
    }

    // Chart 3: Monthly Utilization Rate Trend (%)
    function renderMonthlyUtilizationChart() {
        if (charts.monthlyUtilization) {
            charts.monthlyUtilization.destroy();
        }

        const canvasEl = document.getElementById("monthly-utilization-chart");
        if (!canvasEl) return;
        const ctx = canvasEl.getContext("2d");

        const monthsOrdered = ["May", "June", "July", "August", "September", "October", "November", "December"];
        const uniqueMonths = [...new Set((dashboardData.records || []).map(r => r.month))].filter(Boolean);
        uniqueMonths.sort((a, b) => monthsOrdered.indexOf(a) - monthsOrdered.indexOf(b));

        const labels = uniqueMonths;
        const weightData = [];
        const bpData = [];
        const iotData = [];

        uniqueMonths.forEach(m => {
            const ovInM = (dashboardData.overall_visits || []).filter(v => v.month === m && (currentBlock === "All" || v.block === currentBlock));
            const iotInM = (dashboardData.records || []).filter(r => r.month === m && (currentBlock === "All" || r.block === currentBlock));
            const tot = Math.max(ovInM.length, iotInM.length);

            const wCount = iotInM.filter(r => r.weight_iot !== null).length;
            const bpCount = iotInM.filter(r => r.bp_sys_iot !== null).length;
            const iotCount = iotInM.length;

            weightData.push(tot > 0 ? Number(((wCount / tot) * 100).toFixed(1)) : 0);
            bpData.push(tot > 0 ? Number(((bpCount / tot) * 100).toFixed(1)) : 0);
            iotData.push(tot > 0 ? Number(((iotCount / tot) * 100).toFixed(1)) : 0);
        });

        const allVals = [...weightData, ...bpData, ...iotData];
        const maxVal = allVals.length > 0 ? Math.max(...allVals) : 0;
        const yMax = Math.min(100, Math.max(60, Math.ceil(maxVal / 10) * 10 + 10));

        charts.monthlyUtilization = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Weighing Scale Util. (%)',
                        data: weightData,
                        borderColor: 'rgb(99, 102, 241)',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        borderWidth: 2.5,
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: 'rgb(99, 102, 241)',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: 'BP Machine Util. (%)',
                        data: bpData,
                        borderColor: 'rgb(14, 165, 233)',
                        backgroundColor: 'rgba(14, 165, 233, 0.1)',
                        borderWidth: 2.5,
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: 'rgb(14, 165, 233)',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    },
                    {
                        label: 'Overall IoT Util. (%)',
                        data: iotData,
                        borderColor: 'rgb(16, 185, 129)',
                        backgroundColor: 'rgba(16, 185, 129, 0.05)',
                        borderWidth: 2.2,
                        borderDash: [5, 4],
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: 'rgb(16, 185, 129)',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    }
                ]
            },
            plugins: [{
                id: 'monthlyDatalabels',
                afterDraw: (chart) => {
                    const ctx = chart.ctx;
                    ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
                    ctx.textAlign = 'center';
                    chart.data.datasets.forEach((dataset, i) => {
                        const meta = chart.getDatasetMeta(i);
                        meta.data.forEach((point, index) => {
                            const val = dataset.data[index];
                            if (val === null || val === undefined) return;
                            ctx.fillStyle = dataset.borderColor;
                            const yOffset = i === 0 ? -10 : (i === 1 ? 16 : -10);
                            ctx.fillText(val.toFixed(1) + '%', point.x, point.y + yOffset);
                        });
                    });
                }
            }],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, usePointStyle: true, padding: 15 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: yMax,
                        title: { display: true, text: 'Utilization Rate (%)' },
                        ticks: {
                            callback: (v) => v + '%'
                        }
                    },
                    x: {
                        grid: { display: false },
                        title: { display: true, text: 'Month (2026)' }
                    }
                }
            }
        });
    }

    // Chart 4: Block Risk Breakdown
    function renderBlockRisksChart() {
        if (charts.blockRisks) {
            charts.blockRisks.destroy();
        }

        const ctx = document.getElementById("block-risks-chart").getContext("2d");
        const labels = blocksSummary.map(b => b.name);
        const pihData = blocksSummary.map(b => b.pih);
        const underweightData = blocksSummary.map(b => b.underweight);

        charts.blockRisks = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'PIH',
                        data: pihData,
                        backgroundColor: 'rgba(245, 158, 11, 0.75)',
                        borderColor: 'rgb(245, 158, 11)',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        barPercentage: 0.75
                    },
                    {
                        label: 'Underweight',
                        data: underweightData,
                        backgroundColor: 'rgba(236, 72, 153, 0.75)',
                        borderColor: 'rgb(236, 72, 153)',
                        borderWidth: 1.5,
                        borderRadius: 4,
                        barPercentage: 0.75
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { boxWidth: 12, usePointStyle: true }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 },
                        title: { display: true, text: 'Cases Count' }
                    }
                }
            }
        });
    }

    // ----------------------------------------------------------------------
    // EXPORTS & COPY HANDLERS
    // ----------------------------------------------------------------------
    function generateWeeklyCsvString() {
        let csv = "Date from,Date to,Total distributed,Being used,Total ANC contacts,Weighing Scale Used,BP Machine Used,PIH,Weight <40 kg\n";
        
        weeklySummary.forEach(w => {
            csv += `${formatDateToMDY(w.date_from)},${formatDateToMDY(w.date_to)},${w.total_distributed},${w.being_used},${w.total_anc_contacts},${w.weighing_scale_used},${w.bp_machine_used},${w.pih},${w.weight_under}\n`;
        });
        
        return csv;
    }

    exportCsvBtn.addEventListener("click", () => {
        const csvContent = generateWeeklyCsvString();
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        
        link.setAttribute("href", url);
        link.setAttribute("download", `Sankalp_ANC_Weekly_Report_M_${currentMonth}_B_${currentBlock}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    if (downloadWeeklyBtn) {
        downloadWeeklyBtn.addEventListener("click", () => {
            if (typeof ExcelJS === "undefined") {
                alert("ExcelJS library is not loaded. Cannot export styled Excel.");
                return;
            }

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Weekly Reporting');

            // Define columns
            worksheet.columns = [
                { header: 'Week No.', key: 'week_no', width: 12 },
                { header: 'Date From', key: 'date_from', width: 14 },
                { header: 'Date To', key: 'date_to', width: 14 },
                { header: 'Total Distributed', key: 'total_distributed', width: 18 },
                { header: 'Being Used', key: 'being_used', width: 14 },
                { header: 'Total ANC Contacts', key: 'total_anc_contacts', width: 20 },
                { header: 'Weighing Scale Used', key: 'weighing_scale_used', width: 20 },
                { header: 'Weight Util. %', key: 'weight_util_rate', width: 16 },
                { header: 'BP Machine Used', key: 'bp_machine_used', width: 18 },
                { header: 'BP Util. %', key: 'bp_util_rate', width: 16 },
                { header: 'PIH Cases', key: 'pih', width: 14 },
                { header: 'Weight < 40 kg', key: 'weight_under', width: 16 }
            ];

            // Add rows
            weeklySummary.forEach(w => {
                worksheet.addRow({
                    week_no: `Week ${w.week_no}`,
                    date_from: formatDateToMDY(w.date_from),
                    date_to: formatDateToMDY(w.date_to),
                    total_distributed: w.total_distributed,
                    being_used: w.being_used,
                    total_anc_contacts: w.total_anc_contacts,
                    weighing_scale_used: w.weighing_scale_used,
                    weight_util_rate: w.weight_util_rate / 100,
                    bp_machine_used: w.bp_machine_used,
                    bp_util_rate: w.bp_util_rate / 100,
                    pih: w.pih,
                    weight_under: w.weight_under
                });
            });

            // Style rows & apply conditional color formatting
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) {
                    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    row.eachCell(cell => {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FF1E293B' } // Dark Slate-800
                        };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    });
                } else {
                    const weightRateCell = row.getCell(8);
                    const bpRateCell = row.getCell(10);

                    weightRateCell.numFmt = '0.0%';
                    bpRateCell.numFmt = '0.0%';

                    // Conditional coloring for Weight Util %
                    const wVal = weightRateCell.value * 100;
                    const wColor = getColorForPercentage(wVal);
                    weightRateCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF' + wColor }
                    };
                    weightRateCell.font = { color: { argb: 'FF000000' } };

                    // Conditional coloring for BP Util %
                    const bpVal = bpRateCell.value * 100;
                    const bpColor = getColorForPercentage(bpVal);
                    bpRateCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF' + bpColor }
                    };
                    bpRateCell.font = { color: { argb: 'FF000000' } };

                    // Borders and alignments
                    row.eachCell((cell, colNumber) => {
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                        };
                        if (colNumber >= 4) {
                            cell.alignment = { horizontal: 'right' };
                        } else {
                            cell.alignment = { horizontal: 'center' };
                        }
                    });
                }
            });

            // Trigger download
            workbook.xlsx.writeBuffer().then(buffer => {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.download = `Sankalp_ANC_Weekly_Report_M_${currentMonth}_B_${currentBlock}.xlsx`;
                link.href = url;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }).catch(err => {
                console.error("Failed to generate Weekly Excel: ", err);
                alert("Failed to export Weekly Excel file.");
            });
        });
    }

    function getColorForPercentage(pct) {
        // pct is between 0 and 100
        let r, g, b;
        if (pct < 50) {
            // Interpolate between light Red (254, 226, 226 - #FEE2E2) and light Yellow (254, 243, 199 - #FEF3C7)
            const ratio = pct / 50;
            r = Math.floor(254 + (254 - 254) * ratio);
            g = Math.floor(226 + (243 - 226) * ratio);
            b = Math.floor(226 + (199 - 226) * ratio);
        } else {
            // Interpolate between light Yellow (254, 243, 199 - #FEF3C7) and light Green (220, 252, 231 - #DCFCE7)
            const ratio = (pct - 50) / 50;
            r = Math.floor(254 + (220 - 254) * ratio);
            g = Math.floor(243 + (252 - 243) * ratio);
            b = Math.floor(199 + (231 - 199) * ratio);
        }
        const toHex = (c) => c.toString(16).padStart(2, '0').toUpperCase();
        return toHex(r) + toHex(g) + toHex(b);
    }

    if (downloadSubcentreBtn) {
        downloadSubcentreBtn.addEventListener("click", () => {
            if (typeof ExcelJS === "undefined") {
                alert("ExcelJS library is not loaded. Cannot export styled Excel.");
                return;
            }
            
            // Filter and sort subcentres exactly as shown in the UI leaderboard
            const filteredSub = subcentresSummary.filter(s => {
                const anm = (s.display_anm || s.anm_name || "").toLowerCase();
                return s.name.toLowerCase().includes(subcentreSearchQuery) || 
                       s.block.toLowerCase().includes(subcentreSearchQuery) ||
                       anm.includes(subcentreSearchQuery);
            });
            filteredSub.sort((a, b) => a.iot_rate - b.iot_rate);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Leaderboard');
            
            // Add columns: Block first, Subcentre Name second, ANM Name third
            worksheet.columns = [
                { header: 'Block', key: 'block', width: 16 },
                { header: 'Subcentre Name', key: 'name', width: 25 },
                { header: 'ANM Name', key: 'anm', width: 24 },
                { header: 'Total Contacts', key: 'contacts', width: 15 },
                { header: 'Weight Syncs', key: 'weight_contacts', width: 15 },
                { header: 'Weight Util. %', key: 'weight_rate', width: 15 },
                { header: 'BP Syncs', key: 'bp_contacts', width: 15 },
                { header: 'BP Util. %', key: 'bp_rate', width: 15 },
                { header: 'PIH Cases', key: 'pih', width: 12 },
                { header: 'Underweight', key: 'underweight', width: 15 }
            ];
            
            // Add data rows
            filteredSub.forEach(s => {
                const anmName = s.display_anm || s.anm_name || (s.anms && s.anms.length > 0 ? s.anms.join(", ") : "-");
                worksheet.addRow({
                    block: s.block,
                    name: s.name,
                    anm: anmName,
                    contacts: s.contacts,
                    weight_contacts: s.weight_contacts,
                    weight_rate: s.weight_rate / 100, // represent as float between 0 and 1 for cell formatting
                    bp_contacts: s.bp_contacts,
                    bp_rate: s.bp_rate / 100,
                    pih: s.pih,
                    underweight: s.underweight
                });
            });
            
            // Style rows and apply conditional color formatting
            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) {
                    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                    row.eachCell(cell => {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FF1E293B' } // Dark Slate-800
                        };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    });
                } else {
                    const weightRateCell = row.getCell(6);
                    const bpRateCell = row.getCell(8);
                    
                    weightRateCell.numFmt = '0.0%';
                    bpRateCell.numFmt = '0.0%';
                    
                    // Conditional coloring for Weight Util %
                    const wVal = weightRateCell.value * 100;
                    const wColor = getColorForPercentage(wVal);
                    weightRateCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF' + wColor }
                    };
                    weightRateCell.font = { color: { argb: 'FF000000' } };
                    
                    // Conditional coloring for BP Util %
                    const bpVal = bpRateCell.value * 100;
                    const bpColor = getColorForPercentage(bpVal);
                    bpRateCell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF' + bpColor }
                    };
                    bpRateCell.font = { color: { argb: 'FF000000' } };
                    
                    // Realign data in center in all columns
                    row.eachCell((cell) => {
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                            bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                        };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    });
                }
            });
            
            // Generate buffer and trigger download
            workbook.xlsx.writeBuffer().then(buffer => {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.download = `Sankalp_Subcentre_Leaderboard_M_${currentMonth}_B_${currentBlock}.xlsx`;
                link.href = url;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }).catch(err => {
                console.error("Failed to generate Excel: ", err);
                alert("Failed to export Excel file.");
            });
        });
    }

    if (downloadUtilizationChartBtn) {
        downloadUtilizationChartBtn.addEventListener("click", () => {
            const chartCanvas = document.getElementById("block-utilization-chart");
            if (!chartCanvas) return;
            
            // Fill background with white/slate depending on theme to make it readable when downloaded
            const isDark = htmlEl.getAttribute("data-theme") === "dark";
            const bgColor = isDark ? "#0f172a" : "#ffffff";
            
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = chartCanvas.width;
            tempCanvas.height = chartCanvas.height;
            const tempCtx = tempCanvas.getContext("2d");
            
            tempCtx.fillStyle = bgColor;
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            tempCtx.drawImage(chartCanvas, 0, 0);
            
            const url = tempCanvas.toDataURL("image/png");
            const link = document.createElement("a");
            link.download = "Block-wise_IoT_Device_Utilization_Rate.png";
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    if (downloadMonthlyTrendBtn) {
        downloadMonthlyTrendBtn.addEventListener("click", () => {
            const chartCanvas = document.getElementById("monthly-utilization-chart");
            if (!chartCanvas) return;

            const isDark = htmlEl.getAttribute("data-theme") === "dark";
            const bgColor = isDark ? "#0f172a" : "#ffffff";

            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = chartCanvas.width;
            tempCanvas.height = chartCanvas.height;
            const tempCtx = tempCanvas.getContext("2d");

            tempCtx.fillStyle = bgColor;
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
            tempCtx.drawImage(chartCanvas, 0, 0);

            const url = tempCanvas.toDataURL("image/png");
            const link = document.createElement("a");
            link.download = `Monthly_IoT_Utilization_Rate_Trend_B_${currentBlock}.png`;
            link.href = url;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    function populateFilters() {
        if (!dashboardData || !dashboardData.records) return;

        // 1. Month Filter
        const monthsOrdered = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const uniqueMonths = [...new Set(dashboardData.records.map(r => r.month))].filter(Boolean);
        uniqueMonths.sort((a, b) => monthsOrdered.indexOf(a) - monthsOrdered.indexOf(b));
        
        if (uniqueMonths.length > 0 && monthFilterSelect) {
            let monthHtml = `<option value="All">All Months</option>`;
            uniqueMonths.forEach(m => {
                monthHtml += `<option value="${m}">${m} 2026</option>`;
            });
            monthFilterSelect.innerHTML = monthHtml;
        }

        // 2. Block Filter
        if (blockFilterSelect) {
            const uniqueBlocks = [...new Set(dashboardData.records.map(r => r.block))].filter(b => b);
            uniqueBlocks.sort();
            
            let blockHtml = `<option value="All">All Blocks</option>`;
            uniqueBlocks.forEach(b => {
                blockHtml += `<option value="${b}">${b}</option>`;
            });
            blockFilterSelect.innerHTML = blockHtml;
        }
    }

    function renderLastUpdatedDate() {
        if (!lastUpdatedBadge) return;
        let dateStr = "";
        if (dashboardData && dashboardData.last_updated_date) {
            dateStr = dashboardData.last_updated_date;
        } else if (dashboardData && dashboardData.generated_at) {
            const d = new Date(dashboardData.generated_at);
            if (!isNaN(d.getTime())) {
                const day = String(d.getDate()).padStart(2, "0");
                const month = String(d.getMonth() + 1).padStart(2, "0");
                const year = d.getFullYear();
                dateStr = `${day}-${month}-${year}`;
            }
        }
        if (!dateStr) {
            const today = new Date();
            const day = String(today.getDate()).padStart(2, "0");
            const month = String(today.getMonth() + 1).padStart(2, "0");
            const year = today.getFullYear();
            dateStr = `${day}-${month}-${year}`;
        }
        lastUpdatedBadge.innerHTML = `<i class="fa-regular fa-clock"></i> Last update on ${dateStr}`;
    }

    // ----------------------------------------------------------------------
    // STARTUP INVOCATION
    // ----------------------------------------------------------------------
        renderLastUpdatedDate();
        populateFilters();
        updateChartDefaults();
        processAndRefresh();
    } catch (error) {
        console.error("Critical Dashboard Error:", error);
        alert("Critical Dashboard Error: " + error.message + "\n\nPlease open the browser Developer Console (F12) to see more details.");
    }
});
