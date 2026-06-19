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
    setTimeout(() => {
        loadLiveVendors();
        loadDashboardStats();
        loadPendingPaymentsCenter();
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

        alert('Vendor Accounts Registry Completed Successfully!');
        document.getElementById('add-vendor-form').reset();
        closeModal('vendor-modal');

        loadLiveVendors();
        loadDashboardStats();
    } catch (err) { alert(err.message); }
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
        alert("Profile load failed: " + (err.message || err));
    }
}

function openAdvanceEditModal() {
    if (!activeVendorIdForEdit) {
        alert("Pehle kisi vendor ka 'View Profile' button duba kar profile load karein!");
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
        alert("Vendor select nahi hua!");
        return;
    }
    if (!newVal || !newSlip) {
        alert("Slip Number aur Amount dono dalna zaroori hai!");
        return;
    }

    try {
        const { error } = await currentDb.from('security_deposits').insert([{
            vendor_id: activeVendorIdForEdit,
            slip_number: newSlip,
            amount: newVal
        }]);

        if (error) throw error;

        alert("✅ Nayi Deposit Slip successfully add ho gayi!");

        closeModal('advance-edit-modal');

        // Profile ko refresh karne ke liye thoda delay
        setTimeout(() => {
            fetchAndShowVendorProfile(activeVendorIdForEdit);
            loadDashboardStats();
        }, 400);

    } catch (err) {
        console.error(err);
        alert("Error: " + err.message);
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
    const paymentStatus = document.getElementById('gp-payment-method').value;

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
        alert("Kam se kam aik valid purchase item set karna lazmi hai!");
        return;
    }

    let defaultPaid = (paymentStatus === 'Paid') ? transactionGrandTotal : 0;

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

        alert(`Gate Pass #GP-${realSequenceId} dynamically logged! Printing PDF...`);
        downloadGatePassPDF(realSequenceId, vendorName, itemsList, transactionGrandTotal, paymentStatus);

        document.getElementById('gatepass-form').reset();
        document.getElementById('items-container').innerHTML = '';
        addNewProductRow();
        calculateGrandTotal();

        loadDashboardStats();
        loadPendingPaymentsCenter();

    } catch (err) {
        console.error("Gate pass generation error:", err);
        alert("Database write error: " + err.message);
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
                tbody.innerHTML += `
                    <tr style="border-bottom:1px solid #e2e8f0;">
                        <td style="padding:12px;">${new Date(p.created_at).toLocaleDateString('en-PK')}</td>
                        <td style="padding:12px; font-weight:600;">#GP-${displayNum}</td>
                        <td style="padding:12px; color:#ef4444; font-weight:700;">Rs. ${actualOwed.toLocaleString()} <small style="color:#64748b;font-weight:normal;">(Total: ${p.grand_total})</small></td>
                        <td style="padding:12px;">
                            <button class="btn-primary" style="background:#10b981; padding:6px 12px; font-size:12px;" onclick="initiateSettleFlow('${displayNum}', ${actualOwed}, '${p.id}', ${p.grand_total}, ${p.paid_amount || 0})">Clear Balance</button>
                        </td>
                    </tr>`;
            }
        });

        document.getElementById('vendor-passes-container').style.display = 'block';
        document.getElementById('vendor-passes-container').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { console.error("Table rendering error:", e); }
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
        alert("System connection context issue!");
        return;
    }

    let newTotalPaid = (activePassPaidAmountSoFar || 0) + amountEntering;
    let finalStatus = (newTotalPaid >= activePassGrandTotal) ? 'Paid' : 'Pending';

    try {
        const { error } = await currentDb.from('gate_passes').update({ paid_amount: newTotalPaid, status: finalStatus }).eq('id', activeSettlementPassId);
        if (error) throw error;

        let remaining = activePassGrandTotal - newTotalPaid;
        alert(remaining <= 0 ? `Full Payment Processed! Slip: ${slipNum}` : `Partial Payment Saved! Remaining: Rs. ${remaining.toLocaleString()}`);

        closeModal('payment-modal');
        if (document.getElementById('vendor-passes-container')) document.getElementById('vendor-passes-container').style.display = 'none';

        loadDashboardStats();
        loadPendingPaymentsCenter();
        loadLiveVendors();
    } catch (err) { alert(err.message); }
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
    else { alert("Kam se kam aik item lazmi hai!"); }
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
        alert("Sab fields sahi se bharein!");
        return;
    }

    try {
        const { error } = await getSupabaseClient()
            .from('products')
            .insert([{ category, name, rate }]);

        if (error) throw error;

        alert("✅ New Product Added Successfully!");
        closeModal('product-add-modal');
        loadProductsTable();
    } catch (err) {
        alert("Error: " + err.message);
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
        alert("Sab fields sahi se bharein!");
        return;
    }

    try {
        const { error } = await getSupabaseClient()
            .from('products')
            .update({ category, name, rate })
            .eq('id', currentEditingProductId);

        if (error) throw error;

        alert("✅ Product Updated Successfully!");
        closeModal('product-edit-modal');
        loadProductsTable();
    } catch (err) {
        alert("Error: " + err.message);
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

        alert("✅ Product Deleted!");
        loadProductsTable();
    } catch (err) {
        alert("Delete failed: " + err.message);
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

    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:80px;">
        <i class="fa-solid fa-spinner fa-spin"></i><br><br>Loading Gate Passes...
    </td></tr>`;

    try {
        // Vendor ka naam sath lane ke liye query
        const { data, error } = await getSupabaseClient()
            .from('gate_passes')
            .select('*, vendors(name)')
            .order('created_at', { ascending: false });

        tbody.innerHTML = "";

        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:80px;color:#94a3b8;">
                No gate passes found yet.
            </td></tr>`;
            return;
        }

        data.forEach(inv => {
            const invoiceNum = inv.pass_serial || inv.pass_number || `GP-${inv.id ? inv.id.toString().padStart(5, '0') : 'N/A'}`;
            const vendorNameDisplay = inv.vendors ? inv.vendors.name : (inv.vendor_id || 'N/A');

            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                    <td style="padding: 14px 12px; text-align: center; font-weight: 600; color: #1e293b;">${invoiceNum}</td>
                    <td style="padding: 14px 12px; text-align: center; color: #334155;">${vendorNameDisplay}</td>
                    <td style="padding: 14px 12px; text-align: center; color: #475569;">${new Date(inv.created_at).toLocaleDateString('en-PK')}</td>
                    <td style="padding: 14px 12px; text-align: center; color: #475569;">7 Days</td>
                    <td style="padding: 14px 12px; text-align: right; font-weight: 700; color: #10b981;">
                        Rs. ${parseFloat(inv.grand_total || 0).toLocaleString()}
                    </td>
                    <td style="padding: 14px 12px; text-align: center;">
                        <span class="badge ${inv.status?.toLowerCase() === 'paid' ? 'paid' : 'pending'}">
                            ${inv.status || 'Pending'}
                        </span>
                    </td>
                </tr>`;
        });

    } catch (err) {
        console.error("Invoices Error:", err);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;padding:80px;">
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

        if (tabId === 'invoices') setTimeout(loadInvoicesTable, 300);
        if (tabId === 'products') setTimeout(loadProductsTable, 300);
    };
} else {
    const oldSwitch = switchTab;
    switchTab = function (tabId) {
        oldSwitch(tabId);
        if (tabId === 'invoices') setTimeout(loadInvoicesTable, 300);
        if (tabId === 'products') setTimeout(loadProductsTable, 300);
    };
}