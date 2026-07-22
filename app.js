const SUPABASE_URL = 'https://myckufuzjvgicpiphegj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lLMnno1aBCnV96JDZkT6ug_sZgolKaF';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Register the datalabels plugin safely
if (window.ChartDataLabels) {
  Chart.register(ChartDataLabels);
}

let assetClasses = [];
let currentValues = {};
let snapshots = [];
let historyChart = null;

// Helpers
function formatCurrency(val) {
  const num = parseFloat(val) || 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

// Compact £k notation for Chart labels
function formatCompactCurrency(val) {
  const num = parseFloat(val) || 0;
  const inThousands = Math.round(num / 1000);
  return `£${inThousands}k`;
}

function formatInputValue(val) {
  if (val === '' || val === null || val === undefined) return '';
  const num = parseFloat(val.toString().replace(/,/g, '')) || 0;
  return num.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCurrencyNumber(str) {
  if (!str) return 0;
  return parseFloat(str.toString().replace(/,/g, '')) || 0;
}

// App Initialization
async function initApp() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (session) {
    await showDashboard();
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session) await showDashboard();
    else showLogin();
  });

  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
}

function showLogin() {
  document.getElementById('auth-container').style.display = 'block';
  document.getElementById('app-container').style.display = 'none';
}

async function showDashboard() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';

  document.getElementById('snapshot-date').valueAsDate = new Date();

  // 1. Fetch all data from database
  await fetchAssetClasses();
  await fetchLatestValues();
  await fetchSnapshots();
  
  // 2. Render input forms FIRST so values populate into the DOM
  renderInputForms();

  // 3. Calculate metrics and render chart using those populated values
  calculateAndDisplayNetWorth();
  renderHistoryChart();
  calculateGrowthPercentages();
  updateLastUpdatedBadge();

  document.getElementById('save-values-btn')?.addEventListener('click', saveMonthlySnapshot);
  await fetchAndRenderBreakdownTable();
}

// Auth Handlers
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('auth-error');

  errorEl.innerText = '';
  const btn = document.getElementById('login-btn');
  btn.innerText = 'Logging in...';

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.innerText = error.message;
    btn.innerText = 'Log In';
  }
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
}

async function fetchAssetClasses() {
  const { data, error } = await supabaseClient.from('asset_classes').select('*');
  if (error) console.error('Error fetching categories:', error);
  else assetClasses = data || [];
}

async function fetchLatestValues() {
  const { data, error } = await supabaseClient.from('asset_values').select('*');
  if (error) console.error('Error fetching values:', error);
  else {
    (data || []).forEach(item => {
      currentValues[item.asset_class_id] = item.current_value;
    });
  }
}

async function fetchSnapshots() {
  const { data, error } = await supabaseClient
    .from('monthly_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: true });

  if (error) console.error('Error fetching snapshots:', error);
  else snapshots = data || [];
}

function updateLastUpdatedBadge() {
  const badge = document.getElementById('last-updated-badge');
  if (!badge) return;

  if (snapshots.length > 0) {
    const latestDate = snapshots[snapshots.length - 1].snapshot_date;
    const dateObj = new Date(latestDate);
    const formattedDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    badge.innerText = `Last Updated: ${formattedDate}`;
  } else {
    badge.innerText = 'Last Updated: No Entries Yet';
  }
}

function renderInputForms() {
  const joelContainer = document.getElementById('joel-inputs');
  const emmaContainer = document.getElementById('emma-inputs');
  const jointContainer = document.getElementById('joint-inputs');

  joelContainer.innerHTML = '';
  emmaContainer.innerHTML = '';
  jointContainer.innerHTML = '';

  assetClasses.forEach(ac => {
    const rawVal = currentValues[ac.id] || 0;
    const formattedVal = formatInputValue(rawVal);

    const div = document.createElement('div');
    div.className = 'input-group';
    
    div.innerHTML = `
      <label for="asset-${ac.id}">${ac.name}</label>
      <div class="currency-wrapper">
        <span class="currency-symbol">£</span>
        <input type="text" id="asset-${ac.id}" value="${formattedVal}" data-id="${ac.id}" placeholder="0.00">
      </div>
    `;

    if (ac.owner === 'Joel') joelContainer.appendChild(div);
    else if (ac.owner === 'Emma') emmaContainer.appendChild(div);
    else jointContainer.appendChild(div);

    const inputEl = div.querySelector('input');

    inputEl.addEventListener('input', calculateAndDisplayNetWorth);
    inputEl.addEventListener('blur', (e) => {
      const val = parseCurrencyNumber(e.target.value);
      e.target.value = formatInputValue(val);
      calculateAndDisplayNetWorth();
    });
  });
}

function calculateAndDisplayNetWorth() {
  let liquid = 0;
  let nonLiquid = 0;

  assetClasses.forEach(ac => {
    const input = document.getElementById(`asset-${ac.id}`);
    
    // Read from the input field if it exists and has a value, otherwise fall back directly to currentValues from DB
    let val = 0;
    if (input && input.value !== '') {
      val = parseCurrencyNumber(input.value);
    } else if (currentValues[ac.id] !== undefined) {
      val = parseFloat(currentValues[ac.id]) || 0;
    }

    if (ac.name === 'Mortgage Balance') {
      nonLiquid -= val;
    } else if (ac.is_liability) {
      liquid -= val;
    } else if (ac.is_liquid) {
      liquid += val;
    } else {
      nonLiquid += val;
    }
  });

  const total = liquid + nonLiquid;

  // Fallback to the latest saved snapshot figures if individual asset calculations yield 0
  let finalTotal = total;
  let finalLiquid = liquid;
  let finalNonLiquid = nonLiquid;

  if (total === 0 && snapshots.length > 0) {
    const latestSnapshot = snapshots[snapshots.length - 1];
    finalTotal = latestSnapshot.total_net_worth || 0;
    finalLiquid = latestSnapshot.liquid_net_worth || 0;
    finalNonLiquid = latestSnapshot.non_liquid_net_worth || 0;
  }

  document.getElementById('total-net-worth').innerText = formatCurrency(finalTotal);
  document.getElementById('liquid-net-worth').innerText = formatCurrency(finalLiquid);
  document.getElementById('non-liquid-net-worth').innerText = formatCurrency(finalNonLiquid);

  return { total: finalTotal, liquid: finalLiquid, nonLiquid: finalNonLiquid };
}

async function saveMonthlySnapshot() {
  const btn = document.getElementById('save-values-btn');
  const entryDate = document.getElementById('snapshot-date').value;

  if (!entryDate) {
    alert('Please select a date for this entry.');
    return;
  }

  btn.innerText = 'Saving...';
  btn.disabled = true;

  try {
    for (const ac of assetClasses) {
      const input = document.getElementById(`asset-${ac.id}`);
      const val = parseCurrencyNumber(input?.value || 0);

      await supabaseClient.from('asset_values').upsert({
        asset_class_id: ac.id,
        current_value: val,
        updated_at: new Date().toISOString()
      }, { onConflict: 'asset_class_id' });

      currentValues[ac.id] = val;
    }

    const netWorth = calculateAndDisplayNetWorth();

    await supabaseClient.from('monthly_snapshots').insert({
      snapshot_date: entryDate,
      total_net_worth: netWorth.total,
      liquid_net_worth: netWorth.liquid,
      non_liquid_net_worth: netWorth.nonLiquid
    });

    alert('Saved successfully!');
    await fetchSnapshots();
    renderHistoryChart();
    calculateGrowthPercentages();
    updateLastUpdatedBadge();
  } catch (err) {
    console.error('Save failed:', err);
    alert('Failed to save entry.');
  } finally {
    btn.innerText = 'Save';
    btn.disabled = false;
  }
  // Insert line items into asset_history
const historyInserts = assetClasses.map(ac => {
  const input = document.getElementById(`asset-${ac.id}`);
  const val = input ? parseCurrencyNumber(input.value) : 0;
  return {
    snapshot_date: snapshotDate,
    asset_class_id: ac.id,
    value: val
  };
});

await supabaseClient.from('asset_history').upsert(historyInserts, { onConflict: 'snapshot_date, asset_class_id' });
await fetchAndRenderBreakdownTable(); // Refresh table
}

function calculateGrowthPercentages() {
  if (snapshots.length < 2) return;

  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots[snapshots.length - 2];

  formatGrowth('total-last-growth', latest.total_net_worth, previous.total_net_worth);
  formatGrowth('liquid-last-growth', latest.liquid_net_worth, previous.liquid_net_worth);
  formatGrowth('nonliquid-last-growth', latest.non_liquid_net_worth, previous.non_liquid_net_worth);

  const currentYear = new Date().getFullYear();
  const ytdStart = snapshots.find(s => new Date(s.snapshot_date).getFullYear() === currentYear) || snapshots[0];

  formatGrowth('total-ytd-growth', latest.total_net_worth, ytdStart.total_net_worth, 'YTD');
  formatGrowth('liquid-ytd-growth', latest.liquid_net_worth, ytdStart.liquid_net_worth, 'YTD');
  formatGrowth('nonliquid-ytd-growth', latest.non_liquid_net_worth, ytdStart.non_liquid_net_worth, 'YTD');
}

function formatGrowth(elementId, current, baseline, label = 'vs Last') {
  if (!baseline || baseline === 0) return;
  const pct = (((current - baseline) / Math.abs(baseline)) * 100).toFixed(1);
  const el = document.getElementById(elementId);
  if (!el) return;

  const isPos = pct >= 0;
  el.innerText = `${label}: ${isPos ? '+' : ''}${pct}%`;
  el.className = isPos ? 'growth-positive' : 'growth-negative';
}

function renderHistoryChart() {
  const ctx = document.getElementById('historyChart')?.getContext('2d');
  if (!ctx || snapshots.length === 0) return;

  const labels = snapshots.map(s => {
    if (!s.snapshot_date) return '';
    const parts = s.snapshot_date.split('-');
    if (parts.length >= 2) {
      const year = parts[0].slice(-2);
      const month = parts[1];
      return `${month}-${year}`;
    }
    return s.snapshot_date;
  });

  const totalData = snapshots.map(s => s.total_net_worth);
  const liquidData = snapshots.map(s => s.liquid_net_worth);
  const nonLiquidData = snapshots.map(s => s.non_liquid_net_worth);

  if (historyChart) historyChart.destroy();

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: 'Total Net Worth', data: totalData, borderColor: '#38bdf8', backgroundColor: '#38bdf8', fill: false, tension: 0.2, pointRadius: 5 },
        { label: 'Liquid Net Worth', data: liquidData, borderColor: '#34d399', backgroundColor: '#34d399', fill: false, tension: 0.2, pointRadius: 5 },
        { label: 'Non-Liquid Net Worth', data: nonLiquidData, borderColor: '#fbbf24', backgroundColor: '#fbbf24', fill: false, tension: 0.2, pointRadius: 5 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 35, right: 25, bottom: 10, left: 15 } },
      plugins: {
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#f8fafc',
          font: { weight: 'bold', size: 13 }, // Increased data label font size
          formatter: (value) => formatCompactCurrency(value)
        },
        tooltip: {
          titleFont: { size: 14 },
          bodyFont: { size: 13 },
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` }
        },
        legend: {
          labels: { 
            color: '#cbd5e1', 
            font: { size: 14, weight: '600' }, // Larger legend text
            padding: 20
          }
        }
      },
      scales: {
        x: {
          ticks: { 
            color: '#cbd5e1',
            font: { size: 13, weight: '500' } // Larger X-axis date labels
          },
          grid: { color: '#334155' }
        },
        y: {
          display: false, // Hides the Y-axis numbers & axis entirely
          grid: { display: false }
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initApp);
// State holders
let assetHistoryData = [];
let availableDates = [];

// Fetch granular history and initialize breakdown table
async function fetchAndRenderBreakdownTable() {
  const { data, error } = await supabaseClient
    .from('asset_history')
    .select('snapshot_date, value, asset_class_id, asset_classes(id, name, owner, is_liquid, is_liability)')
    .order('snapshot_date', { ascending: true });

  if (error) {
    console.error('Error fetching asset history:', error);
    return;
  }

  assetHistoryData = data || [];
  
  // Extract last 4 unique snapshot dates
  const uniqueDates = [...new Set(assetHistoryData.map(d => d.snapshot_date))].sort();
  availableDates = uniqueDates.slice(-4);

  populateCategoryFilters();
  setupFilterListeners();
  renderBreakdownTable();
}

// Populate Category Checkboxes dynamically
function populateCategoryFilters() {
  const container = document.getElementById('category-filters');
  if (!container) return;

  const categories = [...new Set(assetClasses.map(ac => ac.name))];
  container.innerHTML = categories.map(cat => `
    <label class="checkbox-pill">
      <input type="checkbox" value="${cat}" checked> ${cat}
    </label>
  `).join('');
}

// Attach change listeners to all filter checkboxes
function setupFilterListeners() {
  // Select All button
  const selectAllBtn = document.getElementById('btn-select-all');
  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      document.querySelectorAll('.filters-container input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
        cb.disabled = false;
      });
      syncFilterDependencies();
      renderBreakdownTable();
    };
  }

  // Deselect All button
  const deselectAllBtn = document.getElementById('btn-deselect-all');
  if (deselectAllBtn) {
    deselectAllBtn.onclick = () => {
      document.querySelectorAll('.filters-container input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
        cb.disabled = false;
      });
      syncFilterDependencies();
      renderBreakdownTable();
    };
  }

  // Asset Type checkboxes listener
  document.querySelectorAll('#type-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      syncFilterDependencies('type');
      renderBreakdownTable();
    });
  });

  // Category checkboxes listener
  document.querySelectorAll('#category-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      syncFilterDependencies('category');
      renderBreakdownTable();
    });
  });

  // Owner checkboxes listener
  document.querySelectorAll('#owner-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', renderBreakdownTable);
  });
}

// Synchronize state and disable/enable controls based on selection source
function syncFilterDependencies(source) {
  const typeCbs = Array.from(document.querySelectorAll('#type-filters input[type="checkbox"]'));
  const categoryCbs = Array.from(document.querySelectorAll('#category-filters input[type="checkbox"]'));

  const liquidTypes = typeCbs.filter(cb => cb.value === 'liquid' && cb.checked);
  const nonLiquidTypes = typeCbs.filter(cb => cb.value === 'non-liquid' && cb.checked);

  if (source === 'type') {
    // If Asset Type is interacting: drive category states and disable category checkboxes
    const hasTypeSelected = typeCbs.some(cb => cb.checked);

    categoryCbs.forEach(catCb => {
      const isLiquidCat = assetClasses.some(ac => ac.name === catCb.value && ac.is_liquid);
      
      if (hasTypeSelected) {
        catCb.disabled = true;
        catCb.checked = (isLiquidCat && liquidTypes.length > 0) || (!isLiquidCat && nonLiquidTypes.length > 0);
      } else {
        catCb.disabled = false;
      }
    });

    // Re-enable type checkboxes
    typeCbs.forEach(cb => cb.disabled = false);

  } else if (source === 'category') {
    // If Category is modified directly: disable Asset Type checkboxes
    const allCategoriesChecked = categoryCbs.every(cb => cb.checked);
    const noCategoriesChecked = categoryCbs.every(cb => !cb.checked);

    if (!allCategoriesChecked && !noCategoriesChecked) {
      typeCbs.forEach(cb => {
        cb.disabled = true;
      });
    } else {
      typeCbs.forEach(cb => cb.disabled = false);
    }
  }

  // Deselect All button
  const deselectAllBtn = document.getElementById('btn-deselect-all');
  if (deselectAllBtn) {
    deselectAllBtn.onclick = () => {
      document.querySelectorAll('.filters-container input[type="checkbox"]').forEach(cb => cb.checked = false);
      renderBreakdownTable();
    };
  }
}

// Render dynamic breakdown table
function renderBreakdownTable() {
  // Get active filter values
  const selectedOwners = Array.from(document.querySelectorAll('#owner-filters input:checked')).map(cb => cb.value);
  const selectedCategories = Array.from(document.querySelectorAll('#category-filters input:checked')).map(cb => cb.value);

  // Set Table Header Dates
  const headerRow = document.getElementById('table-header-row');
  const dateHeadersHTML = availableDates.map(d => {
    const parts = d.split('-');
    const formatted = parts.length >= 2 ? `${parts[1]}-${parts[0].slice(-2)}` : d;
    return `<th>${formatted}</th>`;
  }).join('');

  headerRow.innerHTML = `
    <th>Owner</th>
    <th>Asset / Liability</th>
    <th>Type</th>
    ${dateHeadersHTML}
    <th>Avg Growth</th>
  `;

  // Filter asset classes by Owner and Category (since Asset Type auto-syncs Categories)
  const filteredAssetClasses = assetClasses.filter(ac => {
    const ownerMatch = selectedOwners.includes(ac.owner);
    const categoryMatch = selectedCategories.includes(ac.name);
    return ownerMatch && categoryMatch;
  });

  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  let dateTotals = new Array(availableDates.length).fill(0);

  filteredAssetClasses.forEach(ac => {
    let rowValues = [];
    let stepGrowths = [];

    availableDates.forEach((date, idx) => {
      const match = assetHistoryData.find(h => h.asset_class_id === ac.id && h.snapshot_date === date);
      let rawVal = match ? parseFloat(match.value) || 0 : 0;
      
      // Represent liabilities as negative
      let displayVal = (ac.is_liability || ac.name.includes('Mortgage')) ? -Math.abs(rawVal) : rawVal;
      
      rowValues.push(displayVal);
      dateTotals[idx] += displayVal;
    });

    // Option B: Mean Monthly Growth % across consecutive entries
    for (let i = 1; i < rowValues.length; i++) {
      const prev = rowValues[i - 1];
      const curr = rowValues[i];
      if (prev !== 0) {
        stepGrowths.push((curr - prev) / Math.abs(prev));
      }
    }

    let avgGrowthPct = 0;
    if (stepGrowths.length > 0) {
      avgGrowthPct = (stepGrowths.reduce((a, b) => a + b, 0) / stepGrowths.length) * 100;
    }

    const growthClass = avgGrowthPct > 0 ? 'text-positive' : (avgGrowthPct < 0 ? 'text-negative' : '');
    const growthFormatted = avgGrowthPct === 0 ? '0.0%' : `${avgGrowthPct > 0 ? '+' : ''}${avgGrowthPct.toFixed(1)}%`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ac.owner}</td>
      <td>${ac.name}</td>
      <td>${ac.is_liquid ? 'Liquid' : 'Non-Liquid'}</td>
      ${rowValues.map(v => `<td>${formatCurrency(v)}</td>`).join('')}
      <td class="${growthClass}">${growthFormatted}</td>
    `;
    tbody.appendChild(tr);
  });

  // Calculate overall average growth for totals
  let totalGrowths = [];
  for (let i = 1; i < dateTotals.length; i++) {
    if (dateTotals[i - 1] !== 0) {
      totalGrowths.push((dateTotals[i] - dateTotals[i - 1]) / Math.abs(dateTotals[i - 1]));
    }
  }
  let totalAvgGrowthPct = totalGrowths.length > 0 ? (totalGrowths.reduce((a, b) => a + b, 0) / totalGrowths.length) * 100 : 0;
  const totalGrowthClass = totalAvgGrowthPct > 0 ? 'text-positive' : (totalAvgGrowthPct < 0 ? 'text-negative' : '');

  // Render Footer Totals
  const tfootRow = document.getElementById('table-footer-row');
  tfootRow.innerHTML = `
    <td colspan="3"><strong>Total</strong></td>
    ${dateTotals.map(t => `<td><strong>${formatCurrency(t)}</strong></td>`).join('')}
    <td id="avg-growth-total" class="${totalGrowthClass}"><strong>${totalAvgGrowthPct > 0 ? '+' : ''}${totalAvgGrowthPct.toFixed(1)}%</strong></td>
  `;
}