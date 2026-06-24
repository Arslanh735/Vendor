// Global State Storage Variables
let currentViewingVendorPrice = 0;
let activeVendorIdForEdit = null;

// Core Runtime Context variables mapping
var activeSettlementPassId = null;
var activePassGrandTotal = 0;
var activePassPaidAmountSoFar = 0;

// Base product pricing indexes
const productsData = {
    Goat: [{ name: "Goat Siri", price: 350 }, { name: "Goat Kalegi (Set)", price: 1200 }, { name: "Goat Paye", price: 200 }],
    Cow: [{ name: "Cow Siri", price: 1800 }, { name: "Cow Paye", price: 800 }],
    Camel: [{ name: "Camel Meat (Kg)", price: 1100 }],
    Chicken: [{ name: "Chicken Meat (Kg)", price: 600 }]
};

// Supabase Global Endpoint Initialization
const LIVE_DB_URL = "https://vffogcexjvodssomuksv.supabase.co";
const LIVE_DB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmZm9nY2V4anZvZHNzb211a3N2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTI0NDgsImV4cCI6MjA5NjgyODQ0OH0.aswy1lCG_2hmtThfT6TAp6IJEhJkHxmIaxAlb3UZxJ4";

function getSupabaseClient() {
    return (typeof supabase !== 'undefined') ? supabase.createClient(LIVE_DB_URL, LIVE_DB_KEY) : null;
}

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(async () => {
        if (typeof loadProductsTable === 'function') {
            await loadProductsTable();
        }
        loadLiveVendors();
        loadDashboardStats();
        loadPendingPaymentsCenter();

        // --- AUDIT REPORTING SYSTEM INITIALIZATION ---
        initializeAuditMonthDropdown(); // Pehle dropdown dropdown options set karega
        loadMonthlyProductBreakdownChart(); // Phr dynamic products audit table chart draw karega

        loadMonthlyBusinessChart();
    }, 400);
});

// UI View Changer
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
    const activeTab = document.getElementById(`${tabId}-tab`);
    if (activeTab) activeTab.classList.add('active');
    const activeLink = document.querySelector(`.nav-links a[onclick*="'${tabId}'"]`);
    if (activeLink) activeLink.classList.add('active');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function openPendingTabDirectly() { switchTab('pending-payments'); }

// ================================================================
// ENGINE 1: READ / WRITE VENDORS LEDGERS
// ================================================================

async function registerNewVendor(event) {
    event.preventDefault();
    const name = document.getElementById('v-name').value;
    const nic_number = document.getElementById('v-nic').value;
    const mobile_number = document.getElementById('v-mobile').value;
    const advanceAmount = parseFloat(document.getElementById('v-advance').value);
    const slipNumber = document.getElementById('v-slip').value;

    const currentDb = getSupabaseClient();
    if (!currentDb) return;

    try {
        const { data: vendorData, error: vErr } = await currentDb
            .from('vendors')
            .insert([{ name, nic_number, mobile_number, total_business: 0 }]).select();

        if (vErr) throw vErr;

        const { error: dErr } = await currentDb
            .from('security_deposits')
            .insert([{ vendor_id: vendorData[0].id, slip_number: slipNumber, amount: advanceAmount }]);

        if (dErr) throw dErr;

        showToast('Vendor Accounts Registry Completed Successfully!');
        document.getElementById('add-vendor-form').reset();
        closeModal('vendor-modal');

        loadLiveVendors();
        loadDashboardStats();
    } catch (err) { showToast(err.message); }
}

async function loadLiveVendors() {
    const currentDb = getSupabaseClient();
    const tableBody = document.getElementById('vendors-list-body');
    const gpVendorSelect = document.getElementById('gp-vendor-select');
    if (!currentDb || !tableBody) return;

    try {
        const { data: vendors, error } = await currentDb.from('vendors').select('*').order('name', { ascending: true });
        if (error) throw error;

        if (gpVendorSelect) {
            gpVendorSelect.innerHTML = '<option value="">-- Choose Vendor --</option>';
            vendors.forEach(v => { gpVendorSelect.innerHTML += `<option value="${v.id}">${v.name}</option>`; });
        }

        tableBody.innerHTML = "";
        vendors.forEach(vendor => {
            tableBody.innerHTML += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 12px; font-weight: 600;">${vendor.name}</td>
                    <td style="padding: 12px; color: #475569;">${vendor.nic_number || 'N/A'}</td>
                    <td style="padding: 12px; color: #475569;">${vendor.mobile_number}</td>
                    <td style="padding: 12px;">
                        <button class="btn-primary" style="padding:6px 12px; font-size:13px;" onclick="fetchAndShowVendorProfile('${vendor.id}')">View Profile</button>
                    </td>
                </tr>`;
        });
    } catch (e) { console.error(e); }
}

async function fetchAndShowVendorProfile(vendorId) {
    const currentDb = getSupabaseClient();
    if (!currentDb) {
        console.error("Supabase client not initialized");
        return;
    }

    try {
        console.log("Loading profile for vendor ID:", vendorId);

        // 1. Vendor Basic Details
        const { data: vendor, error: vError } = await currentDb
            .from('vendors')
            .select('*')
            .eq('id', vendorId)
            .single();

        if (vError) throw vError;

        activeVendorIdForEdit = vendorId;

        // Basic Info Fill
        document.getElementById('profile-vendor-name-title').innerText = `${vendor.name} - 360° Full Ledger Profile`;
        document.getElementById('prof-card-name').innerText = vendor.name;
        document.getElementById('prof-date').innerText = new Date(vendor.created_at).toLocaleDateString('en-PK');
        document.getElementById('prof-nic').innerText = vendor.nic_number || 'N/A';
        document.getElementById('prof-mobile').innerText = vendor.mobile_number;
        document.getElementById('prof-total-biz').innerText = 'Rs. ' + (vendor.total_business || 0).toLocaleString();

        // ==================== SECURITY DEPOSITS (FIXED - No created_at) ====================
        const { data: deposits, error: dError } = await currentDb
            .from('security_deposits')
            .select('*')
            .eq('vendor_id', vendorId);

        console.log("Deposits fetched:", deposits);
        console.log("Deposits error:", dError);

        const slipsTableBody = document.getElementById('prof-slips-breakdown-body');
        slipsTableBody.innerHTML = "";
        let totalAdvance = 0;

        if (dError) {
            console.error("Deposits Query Error:", dError);
            slipsTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:red; padding:15px;">Error: ${dError.message}</td></tr>`;
        }
        else if (deposits && deposits.length > 0) {
            // Sort by id (latest first) since created_at doesn't exist
            deposits.sort((a, b) => b.id - a.id);

            deposits.forEach(d => {
                const amount = parseFloat(d.amount || 0);
                totalAdvance += amount;

                const slipDate = new Date(d.created_at || Date.now()).toLocaleDateString('en-PK', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                });

                slipsTableBody.innerHTML += `
                    <tr style="border-bottom: 1px dashed #e2e8f0;">
                        <td style="padding: 6px 4px; color: #64748b;">${slipDate}</td>
                        <td style="padding: 6px 4px; font-weight: 600; color: #334155;">${d.slip_number || 'N/A'}</td>
                        <td style="padding: 6px 4px; text-align: right; color: #10b981; font-weight: 700;">
                            Rs. ${amount.toLocaleString()}
                        </td>
                    </tr>`;
            });
        } else {
            slipsTableBody.innerHTML = `
                <tr>
                    <td colspan="3" style="text-align:center; color:#94a3b8; padding:20px;">
                        <i class="fa-solid fa-receipt"></i><br>No deposit slips found yet
                    </td>
                </tr>`;
        }

        // Total Security Deposit Update
        document.getElementById('prof-advance').innerText = 'Rs. ' + totalAdvance.toLocaleString();
        currentViewingVendorPrice = totalAdvance;

        // Gate Pass History
        const { data: passes } = await currentDb
            .from('gate_passes')
            .select('*')
            .eq('vendor_id', vendorId);

        const historyBody = document.getElementById('vendor-purchase-history-body');
        historyBody.innerHTML = "";

        if (passes && passes.length > 0) {
            passes.sort((a, b) => b.id - a.id); // Latest first
            passes.forEach(p => {
                const statusClass = p.status.toLowerCase() === 'paid' ? 'paid' : 'pending';
                historyBody.innerHTML += `
                    <tr>
                        <td style="padding:10px; font-weight:600;">#GP-${p.id}</td>
                        <td style="padding:10px;">${new Date(p.created_at || Date.now()).toLocaleDateString('en-PK')}</td>
                        <td style="padding:10px; font-weight:700;">Rs. ${p.grand_total.toLocaleString()}</td>
                        <td style="padding:10px;">
                            <span class="badge ${statusClass}">${p.status}</span>
                        </td>
                    </tr>`;
            });
        } else {
            historyBody.innerHTML = `
                <tr>
                    <td colspan="4" style="padding:20px; text-align:center; color:#94a3b8;">
                        No gate passes found.
                    </td>
                </tr>`;
        }

        // Show Profile
        document.getElementById('vendor-360-profile').style.display = 'block';
        document.getElementById('vendor-360-profile').scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
        console.error("Full Profile Error:", err);
        showToast("Profile load failed: " + (err.message || err));
    }
}

function openAdvanceEditModal() {
    if (!activeVendorIdForEdit) {
        showToast("Pehle kisi vendor ka 'View Profile' button duba kar profile load karein!");
        return;
    }
    const currentVendorName = document.getElementById('prof-card-name').innerText;
    document.getElementById('edit-advance-vendor-name').innerText = currentVendorName;
    document.getElementById('new-advance-input').value = "";
    document.getElementById('new-advance-slip-input').value = "";
    openModal('advance-edit-modal');
}

async function saveNewAdvanceAmount(e) {
    e.preventDefault();

    const newVal = parseFloat(document.getElementById('new-advance-input').value);
    const newSlip = document.getElementById('new-advance-slip-input').value.trim();
    const currentDb = getSupabaseClient();

    if (!currentDb || !activeVendorIdForEdit) {
        showToast("Vendor select nahi hua!");
        return;
    }
    if (!newVal || !newSlip) {
        showToast("Slip Number aur Amount dono dalna zaroori hai!");
        return;
    }

    try {
        const { error } = await currentDb.from('security_deposits').insert([{
            vendor_id: activeVendorIdForEdit,
            slip_number: newSlip,
            amount: newVal
        }]);

        if (error) throw error;

        showToast("✅ Nayi Deposit Slip successfully add ho gayi!");

        closeModal('advance-edit-modal');

        // Profile ko refresh karne ke liye thoda delay
        setTimeout(() => {
            fetchAndShowVendorProfile(activeVendorIdForEdit);
            loadDashboardStats();
        }, 400);

    } catch (err) {
        console.error(err);
        showToast("Error: " + err.message);
    }
}
// ================================================================
// ENGINE 2: CORE GATE PASS FORM PROCESSING & SUPABASE TRANSACTIONS
// ================================================================

async function processGatePassEmission(event) {
    event.preventDefault();
    const currentDb = getSupabaseClient();
    if (!currentDb) return;

    const vendorSelect = document.getElementById('gp-vendor-select');
    const vendorId = vendorSelect.value;
    const vendorName = vendorSelect.options[vendorSelect.selectedIndex].text;

    // YAHAN CHANGE KIYA: Dropdown ki bajaye direct 'Pending' set kar diya
    const paymentStatus = 'Pending';

    let itemsList = [];
    let transactionGrandTotal = 0;
    const itemRows = document.querySelectorAll('#items-container .item-row');

    itemRows.forEach(row => {
        const category = row.querySelector('.category-select').value;
        const itemElement = row.querySelector('.item-select');
        const itemName = itemElement.options[itemElement.selectedIndex] ? itemElement.options[itemElement.selectedIndex].text : '';
        const rate = parseFloat(row.querySelector('.item-price-input').value) || 0;
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const total = rate * qty;

        if (category && itemName && qty > 0) {
            itemsList.push({ category, item_name: itemName, rate, qty, total_amount: total });
            transactionGrandTotal += total;
        }
    });

    if (itemsList.length === 0) {
        showToast("Kam se kam aik valid purchase item set karna lazmi hai!");
        return;
    }

    // YAHAN CHANGE KIYA: Hamesha 0 se start hoga jab tak 1 month baad decision na ho
    let defaultPaid = 0;

    try {
        const { data: insertedPass, error: passErr } = await currentDb
            .from('gate_passes')
            .insert([{
                vendor_id: vendorId,
                grand_total: transactionGrandTotal,
                paid_amount: defaultPaid,
                status: paymentStatus,
                items_json: itemsList
            }])
            .select();

        if (passErr) throw passErr;

        const realSequenceId = insertedPass[0].pass_serial || insertedPass[0].id;

        const { data: currentVendorRow } = await currentDb.from('vendors').select('total_business').eq('id', vendorId).single();
        let updatedBusinessVolume = (currentVendorRow ? parseFloat(currentVendorRow.total_business || 0) : 0) + transactionGrandTotal;
        await currentDb.from('vendors').update({ total_business: updatedBusinessVolume }).eq('id', vendorId);

        showToast(`Gate Pass #GP-${realSequenceId} dynamically logged! Printing PDF...`);
        downloadGatePassPDF(realSequenceId, vendorName, itemsList, transactionGrandTotal, paymentStatus);

        document.getElementById('gatepass-form').reset();
        document.getElementById('items-container').innerHTML = '';
        addNewProductRow();
        calculateGrandTotal();

        loadDashboardStats();
        loadPendingPaymentsCenter();

    } catch (err) {
        console.error("Gate pass generation error:", err);
        showToast("Database write error: " + err.message);
    }
}

// ================================================================
// ENGINE 3: CORPORATE STANDARDS INVOICE PRINTER
// ================================================================

function downloadGatePassPDF(passId, vendorName, items, grandTotal, status) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, 210, 35, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(22);
    doc.text("SAYLANI MEAT DEPARTMENT", 15, 15);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);
    doc.text("Automated Vendor Resource Management Control Invoice Engine", 15, 22);
    doc.text("Contact Support: support@saylaniwelfare.com", 15, 27);

    doc.setTextColor(15, 23, 42);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(12);
    doc.text("GATE PASS ACCOUNTS INVOICE", 15, 48);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(10);

    doc.text(`Gate Pass Reference: #GP-${passId}`, 15, 55);
    doc.text(`Generation Timestamp: ${new Date().toLocaleString('en-PK')}`, 15, 61);
    doc.text(`Associated Vendor: ${vendorName}`, 15, 67);

    if (status === "Paid") {
        doc.setFillColor(209, 250, 229);
        doc.rect(145, 50, 50, 12, "F");
        doc.setTextColor(5, 150, 105);
        doc.setFont("Helvetica", "bold");
        doc.text("STATUS: FULLY PAID", 149, 57);
    } else {
        doc.setFillColor(254, 226, 226);
        doc.rect(145, 50, 50, 12, "F");
        doc.setTextColor(220, 38, 38);
        doc.setFont("Helvetica", "bold");
        doc.text("STATUS: ON-ACCOUNT", 147, 57);
    }

    const tableBodyData = items.map(i => [
        i.category,
        i.item_name,
        `PKR ${i.rate.toLocaleString()}`,
        i.qty.toString(),
        `PKR ${i.total_amount.toLocaleString()}`
    ]);

    doc.autoTable({
        startY: 75,
        head: [['Animal Category', 'Item / Part Body Specification', 'Base Rate', 'Logged Qty', 'Total Cost']],
        body: tableBodyData,
        headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { font: "Helvetica", fontSize: 9, cellPadding: 4 },
        columnStyles: { 4: { halign: 'right', fontStyle: 'bold' } },
        theme: 'striped'
    });

    let finalTableY = doc.lastAutoTable.finalY || 85;

    doc.setFillColor(248, 250, 252);
    doc.rect(120, finalTableY + 8, 75, 15, "F");

    doc.setTextColor(15, 23, 42);
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Grand Net Total: PKR ${grandTotal.toLocaleString()}/-`, 124, finalTableY + 17);

    doc.setDrawColor(203, 213, 225);
    doc.line(15, finalTableY + 45, 65, finalTableY + 45);
    doc.line(145, finalTableY + 45, 195, finalTableY + 45);

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("Authorized Issuer Sign", 22, finalTableY + 50);
    doc.text("Receiving Vendor Signature", 152, finalTableY + 50);

    doc.save(`Saylani_GatePass_GP${passId}.pdf`);
}

// ================================================================
// ENGINE 4: CONTROL CENTER PAYMENTS SETTLEMENTS MANAGERS
// ================================================================

async function loadPendingPaymentsCenter() {
    const currentDb = getSupabaseClient();
    const cardsContainer = document.getElementById('pending-vendors-cards-box');
    if (!currentDb || !cardsContainer) return;

    try {
        const { data: pendingPasses, error } = await currentDb
            .from('gate_passes')
            .select('*, vendors(name)')
            .eq('status', 'Pending');

        if (error) throw error;

        let aggregatedPendingStateMap = {};
        pendingPasses.forEach(p => {
            let vName = p.vendors ? p.vendors.name : "Unknown Vendor";
            let actualOwed = p.grand_total - (p.paid_amount || 0);

            if (actualOwed > 0) {
                if (!aggregatedPendingStateMap[vName]) {
                    aggregatedPendingStateMap[vName] = { amountDue: 0, passesCount: 0, vendorName: vName };
                }
                aggregatedPendingStateMap[vName].amountDue += actualOwed;
                aggregatedPendingStateMap[vName].passesCount += 1;
            }
        });

        cardsContainer.innerHTML = "";
        const elementsArray = Object.values(aggregatedPendingStateMap);

        if (elementsArray.length === 0) {
            cardsContainer.innerHTML = `<p style="color:#10b981; font-size:15px; font-weight:600; padding:10px;"><i class="fa-solid fa-circle-check"></i> Mubarak ho! Sab clear hai.</p>`;
            return;
        }

        elementsArray.forEach(row => {
            cardsContainer.innerHTML += `
                <div class="vendor-pay-card" onclick="renderUnpaidPassesTableRows('${row.vendorName.replace(/'/g, "\\'")}')" style="cursor:pointer;">
                    <div class="v-avatar"><i class="fa-solid fa-shop"></i></div>
                    <h4>${row.vendorName}</h4>
                    <span class="pending-count">${row.passesCount} Unpaid Passes</span>
                    <div class="pending-amount" style="color:#ef4444; font-weight:700;">Rs. ${row.amountDue.toLocaleString()} Due</div>
                </div>`;
        });

    } catch (err) { console.error("Error loading pending center:", err); }
}

async function renderUnpaidPassesTableRows(vendorName) {
    const currentDb = getSupabaseClient();
    const tbody = document.getElementById('pending-passes-table-body');
    if (!currentDb || !tbody) return;

    try {
        const { data: passes } = await currentDb.from('gate_passes').select('*, vendors(name)').eq('status', 'Pending');
        const targetPasses = passes.filter(p => p.vendors && p.vendors.name === vendorName);

        document.getElementById('selected-vendor-title').innerText = `Pending Passes Ledger for: ${vendorName}`;
        tbody.innerHTML = "";

        targetPasses.forEach(p => {
            let actualOwed = p.grand_total - (p.paid_amount || 0);
            if (actualOwed > 0) {
                let displayNum = p.pass_serial ? p.pass_serial : p.id;

                // 1 Month (30 Days) Date Calculation Logic
                const passDate = new Date(p.created_at);
                const today = new Date();
                const differenceInDays = Math.floor((today - passDate) / (1000 * 60 * 60 * 24));

                let actionButtonHtml = "";

                if (differenceInDays >= 30) {
                    // Agar 30 din ho chuke hain to decision check trigger karega click pr
                    actionButtonHtml = `
                        <button class="btn-primary" style="background:#ea580c; padding:6px 12px; font-size:12px;" 
                            onclick="handleExpiredPassDecision('${p.id}', '${p.vendor_id}', ${actualOwed}, '${displayNum}', '${vendorName}')">
                            ⚠️ Action Required (30+ Days)
                        </button>`;
                } else {
                    // Normal behavior clear balance ka
                    actionButtonHtml = `
                        <button class="btn-primary" style="background:#10b981; padding:6px 12px; font-size:12px;" 
                            onclick="initiateSettleFlow('${displayNum}', ${actualOwed}, '${p.id}', ${p.grand_total}, ${p.paid_amount || 0})">
                            Clear Balance
                        </button>`;
                }

                tbody.innerHTML += `
                    <tr style="border-bottom:1px solid #e2e8f0;">
                        <td style="padding:12px;">${passDate.toLocaleDateString('en-PK')} (${differenceInDays} days ago)</td>
                        <td style="padding:12px; font-weight:600;">#GP-${displayNum}</td>
                        <td style="padding:12px; color:#ef4444; font-weight:700;">Rs. ${actualOwed.toLocaleString()}</td>
                        <td style="padding:12px;">${actionButtonHtml}</td>
                    </tr>`;
            }
        });

        document.getElementById('vendor-passes-container').style.display = 'block';
        document.getElementById('vendor-passes-container').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { console.error("Table rendering error:", e); }
}

// 1 Month Expiry Prompt Window Handle
async function handleExpiredPassDecision(passId, vendorId, amountDue, displayNum, vendorName) {
    const msg = `Bhai! Gate Pass #GP-${displayNum} ko khade hue 1 mahina ho gaya hai.\n\n` +
        `Aap kia karna chahte hain?\n` +
        `1. ADVANCE SE KATNA HAIN? -> 'OK' Dabaein.\n` +
        `2. PENDING MAIN HI KHADA RAKHNA HAIN? -> 'Cancel' Dabaein.`;

    if (confirm(msg)) {
        // User ne Advance cut select kiya (OK)
        await executeAdvanceDeduction(passId, vendorId, amountDue, displayNum, vendorName);
    } else {
        // User ne Pending chhorna select kiya (Cancel)
        showToast("Theek hai, is gate pass ko pending list main hi barkarar rakha gaya hai.");
    }
}

// Security Advance Deduction Processing Core
async function executeAdvanceDeduction(passId, vendorId, amountDue, displayNum, vendorName) {
    const currentDb = getSupabaseClient();
    if (!currentDb) return;

    try {
        // 1. Pehle check karein vendor ka kul security deposit kitna bacha hai
        const { data: deposits, error: dErr } = await currentDb
            .from('security_deposits')
            .select('amount')
            .eq('vendor_id', vendorId);

        if (dErr) throw dErr;

        let totalAdvanceAvailable = deposits ? deposits.reduce((s, i) => s + parseFloat(i.amount || 0), 0) : 0;

        if (totalAdvanceAvailable < amountDue) {
            showToast(`❌ Deduction Failed! Vendor ka kul advance Rs. ${totalAdvanceAvailable.toLocaleString()} hai, jabki bill Rs. ${amountDue.toLocaleString()} hai. Balance na-kafi hai!`);
            return;
        }

        // 2. Security deposits me minus value entry pass karein taake ledger clear rahe
        const { error: insertErr } = await currentDb.from('security_deposits').insert([{
            vendor_id: vendorId,
            slip_number: `AUTO-DEDUCT-GP${displayNum}`,
            amount: -amountDue // Minus value balance deduct kardegi
        }]);

        if (insertErr) throw insertErr;

        // 3. Gate Pass status ko 'Paid' kar dein
        const { error: passErr } = await currentDb
            .from('gate_passes')
            .update({ paid_amount: amountDue, status: 'Paid' })
            .eq('id', passId);

        if (passErr) throw passErr;

        showToast(`✅ MASHALLAH! Rs. ${amountDue.toLocaleString()} successfully vendor ke advance security account se deduct kar ke Gate Pass #GP-${displayNum} clear kar diya gaya hai!`);

        // UI Refresh
        if (document.getElementById('vendor-passes-container')) document.getElementById('vendor-passes-container').style.display = 'none';
        loadDashboardStats();
        loadPendingPaymentsCenter();
        loadLiveVendors();

    } catch (err) {
        console.error(err);
        showToast("Deduction error: " + err.message);
    }
}

function initiateSettleFlow(passDisplayNum, actualOwed, dbId, grandTotal, paidSoFar) {
    activeSettlementPassId = dbId;
    activePassGrandTotal = parseFloat(grandTotal);
    activePassPaidAmountSoFar = parseFloat(paidSoFar);

    document.getElementById('modal-pass-num').innerText = "#GP-" + passDisplayNum;
    document.getElementById('modal-pass-amount').innerText = "Rs. " + actualOwed.toLocaleString();
    document.getElementById('modal-dn-input').value = "";

    const amountInput = document.getElementById('modal-amount-to-pay');
    if (amountInput) { amountInput.value = actualOwed; }
    openModal('payment-modal');
}

async function executePaymentSettlement(e) {
    if (e) e.preventDefault();

    const currentDb = getSupabaseClient();
    const slipNum = document.getElementById('modal-dn-input').value;
    const amountEntering = parseFloat(document.getElementById('modal-amount-to-pay').value) || 0;

    if (!currentDb || !activeSettlementPassId) {
        showToast("System connection context issue!");
        return;
    }

    let newTotalPaid = (activePassPaidAmountSoFar || 0) + amountEntering;
    let finalStatus = (newTotalPaid >= activePassGrandTotal) ? 'Paid' : 'Pending';

    try {
        const { error } = await currentDb.from('gate_passes').update({ paid_amount: newTotalPaid, status: finalStatus }).eq('id', activeSettlementPassId);
        if (error) throw error;

        let remaining = activePassGrandTotal - newTotalPaid;
        showToast(remaining <= 0 ? `Full Payment Processed! Slip: ${slipNum}` : `Partial Payment Saved! Remaining: Rs. ${remaining.toLocaleString()}`);

        closeModal('payment-modal');
        if (document.getElementById('vendor-passes-container')) document.getElementById('vendor-passes-container').style.display = 'none';

        loadDashboardStats();
        loadPendingPaymentsCenter();
        loadLiveVendors();
    } catch (err) { showToast(err.message); }
}

// ================================================================
// ENGINE 5: GLOBAL STATE CONTEXT COUNTERS RE-AGGREGATIONS
// ================================================================

async function loadDashboardStats() {
    const currentDb = getSupabaseClient();
    if (!currentDb) return;

    try {
        const { data: deposits } = await currentDb.from('security_deposits').select('amount');
        const { data: passes } = await currentDb.from('gate_passes').select('grand_total, paid_amount, status');

        let depositsSum = deposits ? deposits.reduce((s, i) => s + parseFloat(i.amount || 0), 0) : 0;
        let pendingSum = passes ? passes.reduce((s, p) => p.status === 'Pending' ? s + (p.grand_total - (p.paid_amount || 0)) : s, 0) : 0;

        if (document.getElementById('dash-total-deposits')) document.getElementById('dash-total-deposits').innerText = 'PKR ' + depositsSum.toLocaleString();
        if (document.getElementById('dash-total-passes')) document.getElementById('dash-total-passes').innerText = passes ? passes.length : 0;
        if (document.getElementById('dash-pending-payments')) document.getElementById('dash-pending-payments').innerText = 'PKR ' + pendingSum.toLocaleString();
    } catch (e) { console.error(e); }
}

function loadItemsByCategory(categoryDropdown) {
    const row = categoryDropdown.closest('.item-row');
    const itemDropdown = row.querySelector('.item-select');
    const priceInput = row.querySelector('.item-price-input');
    const qtyInput = row.querySelector('.item-qty');
    const totalInput = row.querySelector('.item-total');
    const selectedCategory = categoryDropdown.value;

    itemDropdown.innerHTML = '<option value="">-- Select Item --</option>';
    priceInput.value = ''; qtyInput.value = ''; totalInput.value = 0;
    qtyInput.disabled = true; priceInput.disabled = true;

    if (selectedCategory && productsData[selectedCategory]) {
        itemDropdown.disabled = false;
        productsData[selectedCategory].forEach(prod => {
            let opt = document.createElement('option');
            opt.value = prod.price; opt.textContent = prod.name;
            itemDropdown.appendChild(opt);
        });
    } else { itemDropdown.disabled = true; }
    calculateGrandTotal();
}

function updateDefaultPrice(itemDropdown) {
    const row = itemDropdown.closest('.item-row');
    const priceInput = row.querySelector('.item-price-input');
    const qtyInput = row.querySelector('.item-qty');
    if (itemDropdown.value) {
        priceInput.value = itemDropdown.value;
        priceInput.disabled = false; qtyInput.disabled = false; qtyInput.value = 1;
    } else { priceInput.value = ''; priceInput.disabled = true; qtyInput.disabled = true; qtyInput.value = ''; }
    calculateRowTotal(qtyInput);
}

function calculateRowTotal(inputElement) {
    const row = inputElement.closest('.item-row');
    const price = parseFloat(row.querySelector('.item-price-input').value) || 0;
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    row.querySelector('.item-total').value = price * qty;
    calculateGrandTotal();
}

function calculateGrandTotal() {
    let grandTotal = 0;
    document.querySelectorAll('.item-total').forEach(input => { grandTotal += parseFloat(input.value) || 0; });
    document.getElementById('grand-total-val').innerText = 'Rs. ' + grandTotal.toLocaleString();
}

function addNewProductRow() {
    const container = document.getElementById('items-container');
    const newRow = document.createElement('div');
    newRow.className = 'item-row';
    newRow.innerHTML = `
        <div><select class="category-select" onchange="loadItemsByCategory(this)" required><option value="">-- Choose --</option><option value="Goat">Goat (بکرا)</option><option value="Cow">Cow (گائے)</option><option value="Camel">Camel (اونٹ)</option><option value="Chicken">Chicken (مرغی)</option></select></div>
        <div><select class="item-select" onchange="updateDefaultPrice(this)" required disabled><option value="">-- Select Item --</option></select></div>
        <div><input type="number" class="item-price-input" oninput="calculateRowTotal(this)" placeholder="0" min="0" required disabled></div>
        <div><input type="number" class="item-qty" oninput="calculateRowTotal(this)" placeholder="Qty" min="1" required disabled></div>
        <div><input type="text" class="item-total" value="0" readonly></div>
        <div><button type="button" class="btn-danger" onclick="removeProductRow(this)"><i class="fa-solid fa-trash"></i></button></div>`;
    container.appendChild(newRow);
}

function removeProductRow(btn) {
    if (document.querySelectorAll('.item-row').length > 1) { btn.closest('.item-row').remove(); calculateGrandTotal(); }
    else { showToast("Kam se kam aik item lazmi hai!"); }
}

// ================================================================
// ENGINE 6: PROFESSIONAL PRODUCTS CRUD
// ================================================================

let currentEditingProductId = null;

async function loadProductsTable() {
    const tbody = document.getElementById('products-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:40px;">
        <i class="fa-solid fa-spinner fa-spin"></i> Loading Products...
    </td></tr>`;

    try {
        const { data: products, error } = await getSupabaseClient()
            .from('products')
            .select('*')
            .order('category', { ascending: true });

        tbody.innerHTML = "";

        if (error) throw error;

        if (!products || products.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:40px;color:#94a3b8;">
                No products found yet.
            </td></tr>`;
            return;
        }

        products.forEach(p => {
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding:12px;font-weight:600;">${p.category}</td>
                    <td style="padding:12px;">${p.name}</td>
                    <td style="padding:12px;text-align:center;font-weight:700;color:#10b981;">
                        Rs. ${parseFloat(p.rate).toLocaleString()}
                    </td>
                    <td style="padding:12px;">
                        <button class="btn-primary" style="padding:6px 12px;font-size:13px;margin-right:5px;" 
                            onclick="openEditProductModal('${p.id}', '${p.category}', '${p.name.replace(/'/g, "\\'")}', ${p.rate})">
                            Edit
                        </button>
                        <button class="btn-danger" style="padding:6px 12px;font-size:13px;" 
                            onclick="deleteProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}')">Delete</button>
                    </td>
                </tr>`;
        });

        // Refresh products for Gate Pass form
        Object.keys(productsData).forEach(key => delete productsData[key]);
        products.forEach(p => {
            if (!productsData[p.category]) productsData[p.category] = [];
            productsData[p.category].push({ name: p.name, price: parseFloat(p.rate) });
        });

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:red;padding:40px;">Error: ${err.message}</td></tr>`;
    }
}

// ==================== ADD PRODUCT ====================
function openAddProductModal() {
    document.getElementById('add-category').value = "Goat";
    document.getElementById('add-name').value = "";
    document.getElementById('add-rate').value = "";
    openModal('product-add-modal');
}

async function saveNewProduct(e) {
    e.preventDefault();

    const category = document.getElementById('add-category').value;
    const name = document.getElementById('add-name').value.trim();
    const rate = parseFloat(document.getElementById('add-rate').value);

    if (!name || !rate || rate <= 0) {
        showToast("Sab fields sahi se bharein!");
        return;
    }

    try {
        const { error } = await getSupabaseClient()
            .from('products')
            .insert([{ category, name, rate }]);

        if (error) throw error;

        showToast("✅ New Product Added Successfully!");
        closeModal('product-add-modal');
        loadProductsTable();
    } catch (err) {
        showToast("Error: " + err.message);
    }
}

// ==================== EDIT PRODUCT ====================
function openEditProductModal(id, category, name, rate) {
    currentEditingProductId = id;
    document.getElementById('edit-category').value = category;
    document.getElementById('edit-name').value = name;
    document.getElementById('edit-rate').value = rate;
    openModal('product-edit-modal');
}

async function saveProductEdit(e) {
    e.preventDefault();

    const category = document.getElementById('edit-category').value;
    const name = document.getElementById('edit-name').value.trim();
    const rate = parseFloat(document.getElementById('edit-rate').value);

    if (!name || !rate || rate <= 0) {
        showToast("Sab fields sahi se bharein!");
        return;
    }

    try {
        const { error } = await getSupabaseClient()
            .from('products')
            .update({ category, name, rate })
            .eq('id', currentEditingProductId);

        if (error) throw error;

        showToast("✅ Product Updated Successfully!");
        closeModal('product-edit-modal');
        loadProductsTable();
    } catch (err) {
        showToast("Error: " + err.message);
    }
}

// ==================== DELETE PRODUCT ====================
async function deleteProduct(id, name) {
    if (!confirm(`"${name}" ko delete karna chahte hain?`)) return;

    try {
        const { error } = await getSupabaseClient()
            .from('products')
            .delete()
            .eq('id', id);

        if (error) throw error;

        showToast("✅ Product Deleted!");
        loadProductsTable();
    } catch (err) {
        showToast("Delete failed: " + err.message);
    }
}

// Tab Switch
const originalSwitchTab = switchTab;
switchTab = function (tabId) {
    originalSwitchTab(tabId);
    if (tabId === 'products') {
        setTimeout(loadProductsTable, 200);
    }
};

// ================================================================
// FINAL INVOICES + SAFE SWITCHTAB
// ================================================================

async function loadInvoicesTable() {
    const tbody = document.getElementById('invoices-table-body');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:80px;">
        <i class="fa-solid fa-spinner fa-spin"></i><br><br>Loading Gate Passes...
    </td></tr>`;

    try {
        const { data, error } = await getSupabaseClient()
            .from('gate_passes')
            .select('*, vendors(id, name)')
            .order('created_at', { ascending: false });

        tbody.innerHTML = "";

        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:80px;color:#94a3b8;">
                No gate passes found yet.
            </td></tr>`;
            return;
        }

        data.forEach(inv => {
            const invoiceNum = inv.pass_serial || inv.pass_number || `GP-${inv.id ? inv.id.toString().padStart(5, '0') : 'N/A'}`;
            const vendorNameDisplay = inv.vendors ? inv.vendors.name : (inv.vendor_id || 'N/A');

            // CHECK LOGIC HERE: Agar items_json ya comment string mein 'edited' ka surag mile to tag dikhaye
            const editCommentHtml = inv.is_edited || inv.pass_serial?.includes('(Edit)') ?
                `<br><span style="font-size:11px; color:#ef4444; font-weight:bold; background:#fee2e2; padding:2px 6px; border-radius:4px; margin-top:4px; display:inline-block;">(Edit)</span>` : '';

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                    <td style="padding: 14px 12px; text-align: left; font-weight: 600; color: #1e293b;">${invoiceNum} ${editCommentHtml}</td>
                    <td style="padding: 14px 12px; text-align: left; color: #334155;">${vendorNameDisplay}</td>
                    <td style="padding: 14px 12px; text-align: left; color: #475569;">${new Date(inv.created_at).toLocaleDateString('en-PK')}</td>
                    <td style="padding: 14px 12px; text-align: left; color: #475569;">7 Days</td>
                    <td style="padding: 14px 12px; text-align: left; font-weight: 700; color: #10b981;">
                        Rs. ${parseFloat(inv.grand_total || 0).toLocaleString()}
                    </td>
                    <td style="padding: 14px 12px; text-align: left;">
                        <span class="badge ${inv.status?.toLowerCase() === 'paid' ? 'paid' : 'pending'}">
                            ${inv.status || 'Pending'}
                        </span>
                    </td>
                    <td style="padding: 14px 12px; text-align: left;">
                        <button class="btn-primary" style="padding: 6px 10px; font-size: 12px; background: #3b82f6;" 
                            onclick="openGatePassEditModal('${inv.id}')">
                            <i class="fa-solid fa-pen"></i> Edit
                        </button>
                    </td>
                </tr>`;
        });

    } catch (err) {
        console.error("Invoices Error:", err);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:red;padding:80px;">
            Error: ${err.message}
        </td></tr>`;
    }
}

// Safe Tab Switch (Syntax Error Fix)
if (typeof switchTab !== 'function') {
    window.switchTab = function (tabId) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));

        const tab = document.getElementById(tabId + '-tab');
        if (tab) tab.classList.add('active');

        const link = document.querySelector(`.nav-links a[onclick*="${tabId}"]`);
        if (link) link.classList.add('active');

        // --- DYNAMIC DATA LOAD TRIGGERS ---
        if (tabId === 'invoices') setTimeout(loadInvoicesTable, 300);
        if (tabId === 'products') setTimeout(loadProductsTable, 300);
        if (tabId === 'reports') setTimeout(initializeReportsDropdowns, 300); // FIX: Reports tab trigger added
    };
} else {
    const oldSwitch = switchTab;
    switchTab = function (tabId) {
        oldSwitch(tabId);
        // --- DYNAMIC DATA LOAD TRIGGERS ---
        if (tabId === 'invoices') setTimeout(loadInvoicesTable, 300);
        if (tabId === 'products') setTimeout(loadProductsTable, 300);
        if (tabId === 'reports') setTimeout(initializeReportsDropdowns, 300); // FIX: Reports tab trigger added
    };
}

// Global Toast Notification System
window.showToast = function (message, type = 'success') {
    // Agar pehle se container nahi bana hua to banao
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Toast element create karein
    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;

    // Icon type ke mutabik set karein
    let icon = '<i class="fa-solid fa-circle-check"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-circle-xmark"></i>';
    if (type === 'warning') icon = '<i class="fa-solid fa-circle-exclamation"></i>';
    if (type === 'info') icon = '<i class="fa-solid fa-circle-info"></i>';

    toast.innerHTML = `${icon} <span>${message}</span>`;
    container.appendChild(toast);

    // 3.5 seconds baad animate karke remove karo
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => { toast.remove(); }, 300);
    }, 3500);
}

// 1. Modal open karte waqt items render karein
window.openGatePassEditModal = async function (passId) {
    const currentDb = getSupabaseClient();
    if (!currentDb) return;

    try {
        const { data: pass, error } = await currentDb.from('gate_passes').select('*').eq('id', passId).single();
        if (error) throw error;

        // Populate Vendors Dropdown
        const vendorSelect = document.getElementById('edit-gp-vendor');
        vendorSelect.innerHTML = "";
        const { data: vendors } = await currentDb.from('vendors').select('id, name');
        if (vendors) {
            vendors.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.text = v.name;
                if (v.id == pass.vendor_id) opt.selected = true;
                vendorSelect.appendChild(opt);
            });
        }

        // Populate inputs
        document.getElementById('edit-gp-id').value = pass.id;
        document.getElementById('edit-gp-status').value = pass.status || 'Pending';
        document.getElementById('edit-gp-total').value = pass.grand_total || 0;
        document.getElementById('edit-gp-paid').value = pass.paid_amount || 0;

        // Render Items
        const tableBody = document.getElementById('edit-gp-items-table-body');
        tableBody.innerHTML = "";

        const items = pass.items_json || [];
        items.forEach((item, index) => {
            // Yahan Category ko editable text bana diya taake purani category locked na rahe
            tableBody.innerHTML += `
                <tr class="edit-item-row" style="border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 8px 5px;"><input type="text" class="edit-item-cat" value="${item.category || ''}" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px; background:#f8fafc;" readonly></td>
                    <td style="padding: 8px 5px;"><input type="text" class="edit-item-name" value="${item.item_name || ''}" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;"></td>
                    <td style="padding: 8px 5px;"><input type="number" class="edit-item-rate" value="${item.rate || 0}" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;" oninput="recalculateEditModalGrandTotal()"></td>
                    <td style="padding: 8px 5px;"><input type="number" class="edit-item-qty" value="${item.qty || 0}" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;" oninput="recalculateEditModalGrandTotal()"></td>
                    <td class="edit-item-row-total" style="padding: 8px 5px; text-align: right; font-weight: 600; color: #475569; min-width:100px;">
                        Rs. ${parseFloat(item.total_amount || 0).toLocaleString()}
                    </td>
                </tr>
            `;
        });

        const modal = document.getElementById('gatepass-edit-modal');
        if (modal) modal.classList.add('open');

    } catch (err) {
        if (typeof showToast === 'function') showToast("Error loading pass: " + err.message, "error");
        else alert("Error: " + err.message);
    }
}

// 2. NEW FUNCTION: Table ke andar dynamic dropdowns ke sath nayi row inject karna
window.addNewRowToEditModal = function () {
    const tableBody = document.getElementById('edit-gp-items-table-body');

    // Dynamic Category Options compile karna humari productsData list se
    let categoryOptions = '<option value="">-- Select --</option>';
    if (typeof productsData === 'object') {
        Object.keys(productsData).forEach(cat => {
            categoryOptions += `<option value="${cat}">${cat}</option>`;
        });
    }

    const tr = document.createElement('tr');
    tr.className = 'edit-item-row';
    tr.style.borderBottom = '1px solid #e2e8f0';

    tr.innerHTML = `
        <td style="padding: 8px 5px;">
            <select class="edit-item-cat" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;" onchange="updateEditModalItemDropdown(this)">
                ${categoryOptions}
            </select>
        </td>
        <td style="padding: 8px 5px;">
            <select class="edit-item-name" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;" onchange="updateEditModalItemPrice(this)">
                <option value="">-- Choose Item --</option>
            </select>
        </td>
        <td style="padding: 8px 5px;"><input type="number" class="edit-item-rate" value="0" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;" oninput="recalculateEditModalGrandTotal()"></td>
        <td style="padding: 8px 5px;"><input type="number" class="edit-item-qty" value="0" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:4px;" oninput="recalculateEditModalGrandTotal()"></td>
        <td class="edit-item-row-total" style="padding: 8px 5px; text-align: right; font-weight: 600; color: #475569;">
            Rs. 0
        </td>
    `;
    tableBody.appendChild(tr);
}

// 3. Helper: Jab user category select kare to uske items dropdown load hon
window.updateEditModalItemDropdown = function (catSelect) {
    const row = catSelect.closest('.edit-item-row');
    const itemSelect = row.querySelector('.edit-item-name');
    const category = catSelect.value;

    itemSelect.innerHTML = '<option value="">-- Choose Item --</option>';
    if (category && productsData[category]) {
        productsData[category].forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.price; // Storing price as value for easy fetching
            opt.text = p.name;
            itemSelect.appendChild(opt);
        });
    }
    row.querySelector('.edit-item-rate').value = 0;
    recalculateEditModalGrandTotal();
}

// 4. Helper: Item dropdown choose karne pr automatic current price rate field me bhej dena
window.updateEditModalItemPrice = function (itemSelect) {
    const row = itemSelect.closest('.edit-item-row');
    const rateInput = row.querySelector('.edit-item-rate');
    const chosenPrice = parseFloat(itemSelect.value) || 0;

    rateInput.value = chosenPrice;
    recalculateEditModalGrandTotal();
}

// 5. Grand Total Recalculate Logic (Keeps original rows & new drop-down rows tracked)
window.recalculateEditModalGrandTotal = function () {
    let newGrandTotal = 0;
    const rows = document.querySelectorAll('#edit-gp-items-table-body .edit-item-row');

    rows.forEach(row => {
        const rate = parseFloat(row.querySelector('.edit-item-rate').value) || 0;
        const qty = parseFloat(row.querySelector('.edit-item-qty').value) || 0;
        const rowTotal = rate * qty;

        row.querySelector('.edit-item-row-total').innerText = `Rs. ${rowTotal.toLocaleString()}`;
        newGrandTotal += rowTotal;
    });

    document.getElementById('edit-gp-total').value = newGrandTotal;
}

// 6. Save handler to push clean structural array back to Supabase
window.saveGatePassEdit = async function (event) {
    event.preventDefault();
    const currentDb = getSupabaseClient();
    if (!currentDb) return;

    const passId = document.getElementById('edit-gp-id').value;
    const vendorId = document.getElementById('edit-gp-vendor').value;
    const status = document.getElementById('edit-gp-status').value;
    const total = parseFloat(document.getElementById('edit-gp-total').value) || 0;
    const paid = parseFloat(document.getElementById('edit-gp-paid').value) || 0;

    let compiledItems = [];
    const rows = document.querySelectorAll('#edit-gp-items-table-body .edit-item-row');

    rows.forEach(row => {
        const catElement = row.querySelector('.edit-item-cat');
        const nameElement = row.querySelector('.edit-item-name');

        // Handle dropdown elements vs static inputs
        const category = catElement.value;
        const item_name = nameElement.tagName === 'SELECT' ?
            (nameElement.options[nameElement.selectedIndex] ? nameElement.options[nameElement.selectedIndex].text : '') :
            nameElement.value;

        const rate = parseFloat(row.querySelector('.edit-item-rate').value) || 0;
        const qty = parseFloat(row.querySelector('.edit-item-qty').value) || 0;
        const total_amount = rate * qty;

        if (category && item_name && qty > 0) {
            compiledItems.push({ category, item_name, rate, qty, total_amount });
        }
    });

    try {
        const { error } = await currentDb
            .from('gate_passes')
            .update({
                vendor_id: vendorId,
                status: status,
                grand_total: total,
                paid_amount: paid,
                items_json: compiledItems,
                is_edited: true
            })
            .eq('id', passId);

        if (error) throw error;

        if (typeof showToast === 'function') showToast("MASHALLAH! Gate Pass updated with new products.", "success");
        else alert("Gate Pass updated successfully.");

        closeModal('gatepass-edit-modal');
        loadInvoicesTable();
        loadDashboardStats();

    } catch (err) {
        console.error(err);
        alert("Update failed: " + err.message);
    }
}

// Global variable to hold Chart Instance (taake refresh pr overlap na ho)
let businessChartInstance = null;

window.loadMonthlyBusinessChart = async function () {
    const currentDb = getSupabaseClient();
    const ctx = document.getElementById('businessStackChart');
    if (!currentDb || !ctx) return;

    try {
        const { data: passes, error } = await currentDb
            .from('gate_passes')
            .select('created_at, grand_total');

        if (error) throw error;

        // Last 6 Months ka clean format structure ready karna
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        let monthlyDataStructure = {};

        // Pichle 6 mahino ki list auto-generate karna (Chronological Order)
        for (let i = 5; i >= 0; i--) {
            let d = new Date();
            d.setMonth(d.getMonth() - i);
            let key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyDataStructure[key] = {
                label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
                totalSales: 0
            };
        }

        // Data ko cluster/group karna month keys ke mutabik
        if (passes) {
            passes.forEach(pass => {
                if (!pass.created_at) return;
                const dateObj = new Date(pass.created_at);
                const passMonthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

                if (monthlyDataStructure[passMonthKey]) {
                    monthlyDataStructure[passMonthKey].totalSales += parseFloat(pass.grand_total || 0);
                }
            });
        }

        const chartLabels = Object.keys(monthlyDataStructure).map(k => monthlyDataStructure[k].label);
        const businessVolumeData = Object.keys(monthlyDataStructure).map(k => monthlyDataStructure[k].totalSales);

        if (businessChartInstance) {
            businessChartInstance.destroy();
        }

        businessChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartLabels, // Ab yahan lambi date ki jagah "Jun 2026" jese clean labels aayenge
                datasets: [
                    {
                        label: 'Total Sales Volume',
                        data: businessVolumeData,
                        backgroundColor: 'rgba(16, 185, 129, 0.85)',
                        borderColor: '#10b981',
                        borderWidth: 1.5,
                        borderRadius: 6,
                        maxBarThickness: 45, // FIX: Bar ko zyada mota hone se rokega, aik pyari sleek look dega
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { font: { family: 'Segoe UI', weight: '600', size: 12 }, color: '#475569' }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return ` Rs. ${parseFloat(context.raw).toLocaleString('en-PK')}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: '#64748b', font: { family: 'Segoe UI', weight: '600', size: 12 } }
                    },
                    y: {
                        grid: { color: '#f1f5f9' },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'Segoe UI', weight: '600', size: 11 },
                            callback: function (value) {
                                return 'Rs. ' + value.toLocaleString('en-PK'); // FIX: Side bars pr Rs. aur commas lagaye
                            }
                        }
                    }
                }
            }
        });

    } catch (err) {
        console.error("Chart Rendering Error:", err);
    }
}

// Global variable to hold Product Audit Chart Instance
let productAuditChartInstance = null;

// 1. Dropdown mein pichle 6 mahine auto-populate karne ka function
window.initializeAuditMonthDropdown = function () {
    const monthSelect = document.getElementById('audit-month-select');
    if (!monthSelect) return;

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    monthSelect.innerHTML = "";

    // Aaj se pichle 6 mahine generate karein
    for (let i = 0; i < 6; i++) {
        let d = new Date();
        d.setMonth(d.getMonth() - i);

        let valueKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // Format: YYYY-MM
        let textDisplay = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;

        const opt = document.createElement('option');
        opt.value = valueKey;
        opt.text = textDisplay;
        monthSelect.appendChild(opt);
    }
}

// 2. Selected Month ke mutabik items data fetch kar ke Chart render karne ka core logic
window.loadMonthlyProductBreakdownChart = async function () {
    const currentDb = getSupabaseClient();
    const ctx = document.getElementById('productAuditChart');
    const monthSelect = document.getElementById('audit-month-select');

    if (!currentDb || !ctx || !monthSelect) return;

    const selectedMonthKey = monthSelect.value; // Get YYYY-MM selected by user

    try {
        const { data: passes, error } = await currentDb
            .from('gate_passes')
            .select('created_at, items_json');

        if (error) throw error;

        let productSalesSummary = {};

        if (passes) {
            passes.forEach(pass => {
                if (!pass.created_at || !pass.items_json) return;

                const dateObj = new Date(pass.created_at);
                const passMonthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;

                if (passMonthKey === selectedMonthKey) {
                    const items = Array.isArray(pass.items_json) ? pass.items_json : [];
                    items.forEach(item => {
                        const pName = item.item_name || 'Unknown Item';
                        const pTotal = parseFloat(item.total_amount || 0);

                        if (!productSalesSummary[pName]) {
                            productSalesSummary[pName] = 0;
                        }
                        productSalesSummary[pName] += pTotal;
                    });
                }
            });
        }

        const productLabels = Object.keys(productSalesSummary);
        const productDataValues = Object.values(productSalesSummary);

        if (productAuditChartInstance) {
            productAuditChartInstance.destroy();
        }

        if (productLabels.length === 0) {
            productLabels.push("No Data Available");
            productDataValues.push(0);
        }

        // Upgraded Vertical Bar Chart
        productAuditChartInstance = new Chart(ctx, {
            type: 'bar', // Type bar hi rahega
            data: {
                labels: productLabels,
                datasets: [{
                    label: 'Product Sales Breakdown (Rs.)',
                    data: productDataValues,
                    backgroundColor: 'rgba(59, 130, 246, 0.85)', // Premium blue for products
                    borderColor: '#3b82f6',
                    borderWidth: 1.5,
                    borderRadius: 6, // Sleek modern rounded corners
                    maxBarThickness: 45 // Bars ko ek limit me rakhega
                }]
            },
            options: {
                // FIX: 'indexAxis: y' ko khatam kar diya taake bars strictly vertical khari hon!
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return ` Total Sales: Rs. ${parseFloat(context.raw).toLocaleString('en-PK')}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: '#475569',
                            font: { family: 'Segoe UI', weight: '600', size: 12 }
                        }
                    },
                    y: {
                        grid: { color: '#f1f5f9' },
                        ticks: {
                            color: '#64748b',
                            font: { family: 'Segoe UI', weight: '600', size: 11 },
                            callback: function (value) { return 'Rs. ' + value.toLocaleString('en-PK'); }
                        }
                    }
                }
            }
        });

    } catch (err) {
        console.error("Audit Chart Engine Error:", err);
    }
}

// --- CENTRAL AUDIT REPORTING SYSTEM ENGINE ---
let cachedMonthlyReportData = []; // State holding for monthly logs
let activeVendorReportContext = { vendorName: '', monthLabel: '', items: [], grandTotal: 0 };

// 1. Initialize dropdown options specifically inside Reports tab layout
window.initializeReportsDropdowns = async function () {
    const monthSelect = document.getElementById('report-month-select');
    const vendorSelect = document.getElementById('report-vendor-select');
    const currentDb = getSupabaseClient();
    if (!currentDb) return;

    // Populate Months (Last 6 Months)
    if (monthSelect) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        monthSelect.innerHTML = '<option value="">-- Choose Audit Month --</option>';
        for (let i = 0; i < 6; i++) {
            let d = new Date();
            d.setMonth(d.getMonth() - i);
            let val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            let txt = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
            let opt = new Option(txt, val);
            monthSelect.add(opt);
        }
    }

    // Populate Active Registered Vendors
    if (vendorSelect) {
        vendorSelect.innerHTML = '<option value="">-- Select Corporate Vendor --</option>';
        const { data: vendors } = await currentDb.from('vendors').select('id, name');
        if (vendors) {
            vendors.forEach(v => {
                vendorSelect.add(new Option(v.name, v.id));
            });
        }
    }
}

// ==================== REPORT 1: MONTHLY SALES PROCESSORS ====================
window.generateMonthlySalesReport = async function () {
    const currentDb = getSupabaseClient();
    const targetMonth = document.getElementById('report-month-select').value;
    if (!targetMonth) {
        if (typeof showToast === 'function') showToast("Kripya pehle mahina select karein!", "warning");
        return;
    }

    try {
        const { data: passes, error } = await currentDb.from('gate_passes').select('created_at, items_json');
        if (error) throw error;

        let trackingMatrix = {};
        let runningGrandTotal = 0;

        if (passes) {
            passes.forEach(p => {
                if (!p.created_at || !p.items_json) return;
                const dObj = new Date(p.created_at);
                const passMonthKey = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}`;

                if (passMonthKey === targetMonth) {
                    const items = Array.isArray(p.items_json) ? p.items_json : [];
                    items.forEach(item => {
                        const name = item.item_name || 'Unknown';
                        const qty = parseFloat(item.qty || 0);
                        const total = parseFloat(item.total_amount || 0);

                        if (!trackingMatrix[name]) {
                            trackingMatrix[name] = { qty: 0, total: 0 };
                        }
                        trackingMatrix[name].qty += qty;
                        trackingMatrix[name].total += total;
                        runningGrandTotal += total;
                    });
                }
            });
        }

        // Render Table Body UI
        const tbody = document.getElementById('monthly-report-table-body');
        tbody.innerHTML = "";
        cachedMonthlyReportData = []; // Reset state

        const keys = Object.keys(trackingMatrix);
        if (keys.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:30px;color:#94a3b8;">Is mahine koi sales records nahi milein.</td></tr>`;
            document.getElementById('monthly-report-result-area').style.display = "none";
            return;
        }

        keys.forEach(k => {
            cachedMonthlyReportData.push({ name: k, qty: trackingMatrix[k].qty, total: trackingMatrix[k].total });
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding:10px; font-weight:600; color:#334155;">${k}</td>
                    <td style="padding:10px; text-align:center; color:#475569;">${trackingMatrix[k].qty}</td>
                    <td style="padding:10px; text-align:right; font-weight:700; color:#0f766e;">Rs. ${trackingMatrix[k].total.toLocaleString()}</td>
                </tr>`;
        });

        document.getElementById('monthly-report-grand-total').innerText = `Rs. ${runningGrandTotal.toLocaleString()}`;
        document.getElementById('monthly-report-result-area').style.display = "block";

    } catch (err) {
        console.error(err);
    }
}

// Report 1: PDF EXPORTER WITH EXCELLENT CORPORATE HEADER LAYOUT
window.downloadMonthlyReportPDF = function () {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const monthLabel = document.getElementById('report-month-select').options[document.getElementById('report-month-select').selectedIndex].text;

    // Premium Branding Header Box Area Design
    doc.setFillColor(30, 41, 59); // Charcoal Sidebar theme fill Color
    doc.rect(0, 0, 210, 38, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("SAYLANI MEAT DEPARTMENT", 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setFillColor(16, 185, 129); // Accent line
    doc.rect(14, 20, 50, 1.5, 'F');
    doc.text(`Official Audit Summary Report — Monthly Allocation Matrix`, 14, 26);
    doc.setFont("helvetica", "bold");
    doc.text(`Target Audit Period: ${monthLabel}`, 14, 32);

    // Footer Metas metadata positioning right-aligned
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated Date: ${new Date().toLocaleDateString('en-PK')}`, 150, 16);
    doc.text(`Status: Verified Official`, 150, 22);

    // Constructing Core Data Rows Setup
    let dynamicRows = [];
    let netSum = 0;
    cachedMonthlyReportData.forEach(item => {
        netSum += item.total;
        dynamicRows.push([item.name, item.qty, `Rs. ${item.total.toLocaleString()}`]);
    });
    dynamicRows.push([{ content: 'Grand Total Volume Accumulated:', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold', fillColor: [236, 253, 245] } }, { content: `Rs. ${netSum.toLocaleString()}`, styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [6, 95, 70] } }]);

    doc.autoTable({
        startY: 45,
        head: [['Product Allocation Description', 'Net Quantity (Units)', 'Total Computed Sales Volume']],
        body: dynamicRows,
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { font: 'helvetica', fontSize: 10, cellPadding: 5 }
    });

    doc.save(`Monthly-Audit-Report-${monthLabel.replace(' ', '-')}.pdf`);
}


// ==================== REPORT 2: VENDOR WISE LEDGER BREAKDOWNS ====================
window.loadActiveVendorMonths = async function () {
    const currentDb = getSupabaseClient();
    const vendorId = document.getElementById('report-vendor-select').value;
    const container = document.getElementById('vendor-months-container');
    document.getElementById('vendor-deep-breakdown-area').style.display = "none";

    if (!vendorId) {
        container.innerHTML = `<p style="text-align: center; color: #94a3b8; font-size: 13px; padding: 20px;">Select a vendor to audit monthly statement breakdown.</p>`;
        return;
    }

    container.innerHTML = `<p style="text-align:center;font-size:13px;color:#64748b;padding:15px;"><i class="fa-solid fa-spinner fa-spin"></i> Indexing statements matrix...</p>`;

    try {
        // Fetch all passes related to this single active vendor context
        const { data: passes, error } = await currentDb.from('gate_passes').select('created_at, items_json, grand_total').eq('vendor_id', vendorId);
        if (error) throw error;

        if (!passes || passes.length === 0) {
            container.innerHTML = `<p style="text-align:center;font-size:13px;color:#ef4444;padding:15px;font-weight:600;">Is vendor ka koi gate pass database me majood nahi hai.</p>`;
            return;
        }

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        let structuredMonths = {};

        // Loop passes to group totals inside localized month buckets
        passes.forEach(p => {
            if (!p.created_at) return;
            const d = new Date(p.created_at);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

            if (!structuredMonths[key]) {
                structuredMonths[key] = { label: `${monthNames[d.getMonth()]} ${d.getFullYear()}`, rawItems: [], totalVolume: 0 };
            }

            structuredMonths[key].totalVolume += parseFloat(p.grand_total || 0);
            const items = Array.isArray(p.items_json) ? p.items_json : [];
            items.forEach(i => structuredMonths[key].rawItems.push(i));
        });

        // Clear wrapper container and map active action rows layout
        container.innerHTML = "";
        Object.keys(structuredMonths).forEach(monthKey => {
            const mData = structuredMonths[monthKey];
            const divRow = document.createElement('div');
            divRow.style = "display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 8px; transition: 0.2s;";
            divRow.innerHTML = `
                <div>
                    <span style="font-weight:700; color:#1e293b; font-size:13px;">${mData.label}</span>
                    <br><span style="font-size:11px; color:#64748b;">Accumulated Business: Rs. ${mData.totalVolume.toLocaleString()}</span>
                </div>
                <button type="button" class="btn-primary" style="padding:5px 10px; font-size:12px; background:#2563eb;" 
                    onclick="openVendorDeepAuditReport('${monthKey}', '${mData.label}', ${JSON.stringify(mData.rawItems).replace(/"/g, '&quot;')}, ${mData.totalVolume})">
                    <i class="fa-solid fa-folder-open"></i> View Items
                </button>
            `;
            container.appendChild(divRow);
        });

    } catch (err) {
        console.error(err);
    }
}

// Render dynamic sub-nested deep layout on specific row call triggers
window.openVendorDeepAuditReport = function (monthKey, monthLabel, itemsList, grandTotal) {
    const vSelect = document.getElementById('report-vendor-select');
    const vendorName = vSelect.options[vSelect.selectedIndex].text;

    // Populating localized contexts states
    activeVendorReportContext = { vendorName, monthLabel, items: itemsList, grandTotal };

    document.getElementById('vendor-deep-title').innerHTML = `<i class="fa-solid fa-receipt"></i> Items Breakdown for ${vendorName} (${monthLabel})`;

    const tbody = document.getElementById('vendor-deep-table-body');
    tbody.innerHTML = "";

    // Cluster multiple gate pass items matching same products names together
    let clustered = {};
    itemsList.forEach(item => {
        const name = item.item_name || 'N/A';
        const rate = parseFloat(item.rate || 0);
        const qty = parseFloat(item.qty || 0);
        const total = parseFloat(item.total_amount || 0);

        if (!clustered[name]) {
            clustered[name] = { qty: 0, rate: rate, total: 0 };
        }
        clustered[name].qty += qty;
        clustered[name].total += total;
    });

    Object.keys(clustered).forEach(name => {
        tbody.innerHTML += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding:6px 8px; font-weight:600; color:#334155;">${name}</td>
                <td style="padding:6px 8px; text-align:center; color:#475569;">${clustered[name].qty}</td>
                <td style="padding:6px 8px; text-align:right; color:#475569;">Rs. ${clustered[name].rate.toLocaleString()}</td>
                <td style="padding:6px 8px; text-align:right; font-weight:700; color:#1d4ed8;">Rs. ${clustered[name].total.toLocaleString()}</td>
            </tr>
        `;
    });

    document.getElementById('vendor-deep-grand-total').innerText = `Rs. ${grandTotal.toLocaleString()}`;
    document.getElementById('vendor-deep-breakdown-area').style.display = "block";
}

// Report 2: PRINT INDEPENDENT VENDOR MONTHLY STATEMENT PDF
window.downloadVendorMonthlyReportPDF = function () {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const ctx = activeVendorReportContext;

    if (!ctx.vendorName) return;

    // Blue corporate theme header block styling for specific corporate accounts ledgers
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, 210, 38, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("SAYLANI MEAT CONTEXT ERP", 14, 16);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setFillColor(37, 99, 235); // Blue Accent line
    doc.rect(14, 20, 50, 1.5, 'F');
    doc.text(`Corporate Vendor Business Ledger Summary Account Statement`, 14, 26);

    doc.setFont("helvetica", "bold");
    doc.text(`Vendor: ${ctx.vendorName}  |  Period: ${ctx.monthLabel}`, 14, 32);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Print Date: ${new Date().toLocaleDateString('en-PK')}`, 150, 16);
    doc.text(`Account Token: VND-${Math.floor(Math.random() * 90000) + 10000}`, 150, 22);

    let rows = [];
    let clustered = {};
    ctx.items.forEach(item => {
        const name = item.item_name || 'N/A';
        if (!clustered[name]) clustered[name] = { qty: 0, rate: item.rate, total: 0 };
        clustered[name].qty += parseFloat(item.qty || 0);
        clustered[name].total += parseFloat(item.total_amount || 0);
    });

    Object.keys(clustered).forEach(k => {
        rows.push([k, clustered[k].qty, `Rs. ${parseFloat(clustered[k].rate).toLocaleString()}`, `Rs. ${clustered[k].total.toLocaleString()}`]);
    });
    rows.push([{ content: 'Net Statement Grand Total Volume:', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold', fillColor: [239, 246, 255] } }, { content: `Rs. ${ctx.grandTotal.toLocaleString()}`, styles: { fontStyle: 'bold', fillColor: [239, 246, 255], textColor: [29, 78, 216] } }]);

    doc.autoTable({
        startY: 45,
        head: [['Item Description Name', 'Net Stock Units Supplied', 'Agreed Unit Rate', 'Net Amount (PKR)']],
        body: rows,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 4 }
    });

    doc.save(`Statement-${ctx.vendorName.replace(/ /g, '-')}-${ctx.monthLabel.replace(/ /g, '-')}.pdf`);
}