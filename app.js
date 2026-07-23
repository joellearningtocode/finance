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
let retirementChart = null;
let decumulationChart = null;
let annualDrawdownChart = null;

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

// Compact £k and £m notation for Chart labels
function formatCompactCurrency(val) {
  const num = parseFloat(val) || 0;
  if (Math.abs(num) >= 1000000) {
    const inMillions = (num / 1000000).toFixed(2);
    return `£${inMillions}m`;
  } else {
    const inThousands = Math.round(num / 1000);
    return `£${inThousands}k`;
  }
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

  // Register Event Listeners
  setupNavigationListeners();
  setupRetirementInputListeners();
  setupRetirementSeriesFilterListeners();
  setupDecumulationSeriesFilterListeners();

  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

  if (session) {
    await showDashboard();
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session) await showDashboard();
    else showLogin();
  });
}

// Setup Series Toggle Listeners for Accumulation Retirement Chart
function setupRetirementSeriesFilterListeners() {
  const selectAllBtn = document.getElementById('ret-btn-select-all');
  const deselectAllBtn = document.getElementById('ret-btn-deselect-all');
  const checkboxes = document.querySelectorAll('.ret-series-toggle');

  if (!checkboxes.length) return;

  const syncChartVisibility = () => {
    if (!retirementChart) return;

    checkboxes.forEach(cb => {
      const datasetIndex = parseInt(cb.getAttribute('data-dataset'), 10);
      const isVisible = cb.checked;
      retirementChart.setDatasetVisibility(datasetIndex, isVisible);
    });

    retirementChart.update();
  };

  checkboxes.forEach(cb => {
    cb.addEventListener('change', syncChartVisibility);
  });

  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      checkboxes.forEach(cb => cb.checked = true);
      syncChartVisibility();
    };
  }

  if (deselectAllBtn) {
    deselectAllBtn.onclick = () => {
      checkboxes.forEach(cb => cb.checked = false);
      syncChartVisibility();
    };
  }
}

// Setup Series Toggle Listeners for Decumulation Chart
function setupDecumulationSeriesFilterListeners() {
  const selectAllBtn = document.getElementById('dec-btn-select-all');
  const deselectAllBtn = document.getElementById('dec-btn-deselect-all');
  const checkboxes = document.querySelectorAll('.dec-series-toggle');

  if (!checkboxes.length) return;

  const syncChartVisibility = () => {
    if (!decumulationChart) return;

    checkboxes.forEach(cb => {
      const datasetIndex = parseInt(cb.getAttribute('data-dataset'), 10);
      const isVisible = cb.checked;
      decumulationChart.setDatasetVisibility(datasetIndex, isVisible);
    });

    decumulationChart.update();
  };

  checkboxes.forEach(cb => {
    cb.addEventListener('change', syncChartVisibility);
  });

  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      checkboxes.forEach(cb => cb.checked = true);
      syncChartVisibility();
    };
  }

  if (deselectAllBtn) {
    deselectAllBtn.onclick = () => {
      checkboxes.forEach(cb => cb.checked = false);
      syncChartVisibility();
    };
  }
}

function showLogin() {
  document.getElementById('auth-container').style.display = 'block';
  document.getElementById('app-container').style.display = 'none';
}

async function showDashboard() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'block';

  document.getElementById('snapshot-date').valueAsDate = new Date();

  setupNavigationListeners();

  await fetchAssetClasses();
  await fetchLatestValues();
  await fetchSnapshots();
 
  renderInputForms();

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

  let finalTotal = total;
  let finalLiquid = liquid;
  let finalNonLiquid = nonLiquid;

  if (total === 0 && snapshots.length > 0) {
    const latestSnapshot = snapshots[snapshots.length - 1];
    finalTotal = latestSnapshot.total_net_worth || 0;
    finalLiquid = latestSnapshot.liquid_net_worth || 0;
    finalNonLiquid = latestSnapshot.non_liquid_net_worth || 0;
  }

  // Calculate percentages relative to Total Net Worth
  let liquidPct = 0;
  let nonLiquidPct = 0;

  if (finalTotal > 0) {
    liquidPct = Math.round((finalLiquid / finalTotal) * 100);
    nonLiquidPct = Math.round((finalNonLiquid / finalTotal) * 100);
  }

  // Display Currency Values
  document.getElementById('total-net-worth').innerText = formatCurrency(finalTotal);
  document.getElementById('liquid-net-worth').innerText = formatCurrency(finalLiquid);
  document.getElementById('non-liquid-net-worth').innerText = formatCurrency(finalNonLiquid);

  // Display Percentage Badges in Headings
  const liquidPctEl = document.getElementById('liquid-pct');
  const nonLiquidPctEl = document.getElementById('nonliquid-pct');

  if (liquidPctEl) liquidPctEl.innerText = `(${liquidPct}%)`;
  if (nonLiquidPctEl) nonLiquidPctEl.innerText = `(${nonLiquidPct}%)`;

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

    const historyInserts = assetClasses.map(ac => {
      const input = document.getElementById(`asset-${ac.id}`);
      const val = input ? parseCurrencyNumber(input.value) : 0;
      return {
        snapshot_date: entryDate,
        asset_class_id: ac.id,
        value: val
      };
    });

    await supabaseClient.from('asset_history').upsert(historyInserts, { onConflict: 'snapshot_date, asset_class_id' });

    alert('Saved successfully!');
    await fetchSnapshots();
    renderHistoryChart();
    calculateGrowthPercentages();
    updateLastUpdatedBadge();
    await fetchAndRenderBreakdownTable();
  } catch (err) {
    console.error('Save failed:', err);
    alert('Failed to save entry.');
  } finally {
    btn.innerText = 'Save';
    btn.disabled = false;
  }
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
          font: { weight: 'bold', size: 13 },
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
            font: { size: 14, weight: '600' },
            padding: 20
          }
        }
      },
      scales: {
        x: {
          ticks: { 
            color: '#cbd5e1',
            font: { size: 13, weight: '500' }
          },
          grid: { color: '#334155' }
        },
        y: {
          display: false,
          grid: { display: false }
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initApp);

let assetHistoryData = [];
let availableDates = [];

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
  
  const uniqueDates = [...new Set(assetHistoryData.map(d => d.snapshot_date))].sort();
  availableDates = uniqueDates.slice(-4);

  populateCategoryFilters();
  setupFilterListeners();
  renderBreakdownTable();
}

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

function setupFilterListeners() {
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

  document.querySelectorAll('#type-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      syncFilterDependencies('type');
      renderBreakdownTable();
    });
  });

  document.querySelectorAll('#category-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      syncFilterDependencies('category');
      renderBreakdownTable();
    });
  });

  document.querySelectorAll('#owner-filters input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', renderBreakdownTable);
  });
}

function syncFilterDependencies(source) {
  const typeCbs = Array.from(document.querySelectorAll('#type-filters input[type="checkbox"]'));
  const categoryCbs = Array.from(document.querySelectorAll('#category-filters input[type="checkbox"]'));

  const liquidTypes = typeCbs.filter(cb => cb.value === 'liquid' && cb.checked);
  const nonLiquidTypes = typeCbs.filter(cb => cb.value === 'non-liquid' && cb.checked);

  if (source === 'type') {
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

    typeCbs.forEach(cb => cb.disabled = false);

  } else if (source === 'category') {
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
}

function renderBreakdownTable() {
  const selectedOwners = Array.from(document.querySelectorAll('#owner-filters input:checked')).map(cb => cb.value);
  const selectedCategories = Array.from(document.querySelectorAll('#category-filters input:checked')).map(cb => cb.value);

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
    <th>Total Growth</th>
  `;

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
      let displayVal = (ac.is_liability || ac.name.includes('Mortgage')) ? -Math.abs(rawVal) : rawVal;
      
      rowValues.push(displayVal);
      dateTotals[idx] += displayVal;
    });

    for (let i = 1; i < rowValues.length; i++) {
      const prev = rowValues[i - 1];
      const curr = rowValues[i];
      if (prev !== 0) {
        stepGrowths.push((curr - prev) / Math.abs(prev));
      }
    }
    let avgGrowthPct = stepGrowths.length > 0 ? (stepGrowths.reduce((a, b) => a + b, 0) / stepGrowths.length) * 100 : 0;
    const avgGrowthClass = avgGrowthPct > 0 ? 'text-positive' : (avgGrowthPct < 0 ? 'text-negative' : '');
    const avgGrowthFormatted = avgGrowthPct === 0 ? '0.0%' : `${avgGrowthPct > 0 ? '+' : ''}${avgGrowthPct.toFixed(1)}%`;

    let totalGrowthHTML = 'N/A';
    if (!ac.is_liability && !ac.name.includes('Mortgage')) {
      const baselineMatch = assetHistoryData.find(h => h.asset_class_id === ac.id && h.snapshot_date.startsWith('2025-01'));
      const baselineVal = baselineMatch ? parseFloat(baselineMatch.value) || 0 : 0;
      const latestVal = rowValues[rowValues.length - 1] || 0;

      if (baselineVal > 0) {
        const totalGrowthPct = ((latestVal - baselineVal) / baselineVal) * 100;
        const totalGrowthClass = totalGrowthPct > 0 ? 'text-positive' : (totalGrowthPct < 0 ? 'text-negative' : '');
        const formattedTotal = `${totalGrowthPct > 0 ? '+' : ''}${totalGrowthPct.toFixed(1)}%`;
        totalGrowthHTML = `<span class="${totalGrowthClass}">${formattedTotal}</span>`;
      }
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ac.owner}</td>
      <td>${ac.name}</td>
      <td>${ac.is_liquid ? 'Liquid' : 'Non-Liquid'}</td>
      ${rowValues.map(v => `<td>${formatCurrency(v)}</td>`).join('')}
      <td class="${avgGrowthClass}">${avgGrowthFormatted}</td>
      <td>${totalGrowthHTML}</td>
    `;
    tbody.appendChild(tr);
  });

  let totalGrowths = [];
  for (let i = 1; i < dateTotals.length; i++) {
    if (dateTotals[i - 1] !== 0) {
      totalGrowths.push((dateTotals[i] - dateTotals[i - 1]) / Math.abs(dateTotals[i - 1]));
    }
  }
  let totalAvgGrowthPct = totalGrowths.length > 0 ? (totalGrowths.reduce((a, b) => a + b, 0) / totalGrowths.length) * 100 : 0;
  const totalAvgGrowthClass = totalAvgGrowthPct > 0 ? 'text-positive' : (totalAvgGrowthPct < 0 ? 'text-negative' : '');

  let overallTotalGrowthHTML = 'N/A';
  if (dateTotals.length > 0) {
    const firstTotal = dateTotals[0];
    const lastTotal = dateTotals[dateTotals.length - 1];
    
    if (firstTotal !== 0) {
      const overallTotalGrowthPct = ((lastTotal - firstTotal) / Math.abs(firstTotal)) * 100;
      const overallTotalGrowthClass = overallTotalGrowthPct > 0 ? 'text-positive' : (overallTotalGrowthPct < 0 ? 'text-negative' : '');
      overallTotalGrowthHTML = `<strong class="${overallTotalGrowthClass}">${overallTotalGrowthPct > 0 ? '+' : ''}${overallTotalGrowthPct.toFixed(1)}%</strong>`;
    }
  }

  const tfootRow = document.getElementById('table-footer-row');
  tfootRow.innerHTML = `
    <td colspan="3"><strong>Total</strong></td>
    ${dateTotals.map(t => `<td><strong>${formatCurrency(t)}</strong></td>`).join('')}
    <td id="avg-growth-total" class="${totalAvgGrowthClass}"><strong>${totalAvgGrowthPct > 0 ? '+' : ''}${totalAvgGrowthPct.toFixed(1)}%</strong></td>
    <td id="total-growth-total">${overallTotalGrowthHTML}</td>
  `;
}

// Retirement Engine State Holders
let currentRetirementView = 'net-assets';
let baselineRetirementData = {
  snapshotDate: null,
  joelISA: 0,
  emmaISA: 0,
  joelPension: 0,
  emmaPension: 0,
  joelGIA: 0,
  emmaGIA: 0,
  jointGIA: 0
};

function setupNavigationListeners() {
  const btnNetAssets = document.getElementById('nav-net-assets');
  const btnRetirement = document.getElementById('nav-retirement');
  const viewNetAssets = document.getElementById('view-net-assets');
  const viewRetirement = document.getElementById('view-retirement');

  if (!btnNetAssets || !btnRetirement || !viewNetAssets || !viewRetirement) {
    console.error('Navigation elements missing!', { btnNetAssets, btnRetirement, viewNetAssets, viewRetirement });
    return;
  }

  btnNetAssets.onclick = (e) => {
    e.preventDefault();
    btnNetAssets.classList.add('active');
    btnRetirement.classList.remove('active');
    viewNetAssets.style.display = 'block';
    viewRetirement.style.display = 'none';
    currentRetirementView = 'net-assets';
  };

  btnRetirement.onclick = (e) => {
    e.preventDefault();
    btnRetirement.classList.add('active');
    btnNetAssets.classList.remove('active');
    viewNetAssets.style.display = 'none';
    
    viewRetirement.style.display = 'block';
    currentRetirementView = 'retirement';

    extractRetirementBaselineData();

    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      if (retirementChart) {
        retirementChart.resize();
        retirementChart.update();
      }
      if (decumulationChart) {
        decumulationChart.resize();
        decumulationChart.update();
      }
      if (annualDrawdownChart) {
        annualDrawdownChart.resize();
        annualDrawdownChart.update();
      }
    }, 50);
  };
}

function extractRetirementBaselineData() {
  if (snapshots && snapshots.length > 0) {
    baselineRetirementData.snapshotDate = snapshots[snapshots.length - 1].snapshot_date;
  } else {
    baselineRetirementData.snapshotDate = new Date().toISOString().split('T')[0];
  }

  baselineRetirementData.joelISA = 0;
  baselineRetirementData.emmaISA = 0;
  baselineRetirementData.joelPension = 0;
  baselineRetirementData.emmaPension = 0;
  baselineRetirementData.joelGIA = 0;
  baselineRetirementData.emmaGIA = 0;
  baselineRetirementData.jointGIA = 0;

  if (assetClasses && assetClasses.length > 0) {
    assetClasses.forEach(ac => {
      const input = document.getElementById(`asset-${ac.id}`);
      let val = 0;
      
      if (input && input.value !== '' && input.value !== undefined) {
        val = parseCurrencyNumber(input.value);
      } else if (currentValues[ac.id] !== undefined) {
        val = parseFloat(currentValues[ac.id]) || 0;
      }

      const nameLower = (ac.name || '').toLowerCase();
      const owner = ac.owner;

      if (nameLower.includes('isa')) {
        if (owner === 'Joel') baselineRetirementData.joelISA += val;
        if (owner === 'Emma') baselineRetirementData.emmaISA += val;
      } 
      else if (nameLower.includes('pension') || nameLower.includes('sipp')) {
        if (owner === 'Joel') baselineRetirementData.joelPension += val;
        if (owner === 'Emma') baselineRetirementData.emmaPension += val;
      } 
      else if (nameLower.includes('gia') || nameLower.includes('brokerage') || nameLower.includes('investment')) {
        if (owner === 'Joel') baselineRetirementData.joelGIA += val;
        if (owner === 'Emma') baselineRetirementData.emmaGIA += val;
        if (owner === 'Joint') baselineRetirementData.jointGIA += val;
      }
    });
  }

  calculateRetirementForecast();
}

function calculateRetirementYear(dobString, age) {
  const dob = new Date(dobString);
  return dob.getFullYear() + parseInt(age, 10);
}

// Helper to calculate exact Emma age on Joel's retirement date
function calculateEmmaAgeAtRetirement(joelRetireYear) {
  const emmaDob = new Date('1994-03-25');
  const retDate = new Date(joelRetireYear, 9, 21); // October of Joel's retirement year
  let ageYears = retDate.getFullYear() - emmaDob.getFullYear();
  let monthDiff = retDate.getMonth() - emmaDob.getMonth();
  if (monthDiff < 0) {
    ageYears--;
    monthDiff += 12;
  }
  return (ageYears + (monthDiff / 12)).toFixed(1);
}

// Mortgage Amortization & Balance Calculator
// Progressive SDLT (Stamp Duty) Band Calculator
function calculateSDLT(propertyValue) {
  let tax = 0;
  if (propertyValue > 1500000) {
    tax += (propertyValue - 1500000) * 0.12;
    propertyValue = 1500000;
  }
  if (propertyValue > 925000) {
    tax += (propertyValue - 925000) * 0.10;
    propertyValue = 925000;
  }
  if (propertyValue > 250000) {
    tax += (propertyValue - 250000) * 0.05;
    propertyValue = 250000;
  }
  if (propertyValue > 125000) {
    tax += (propertyValue - 125000) * 0.02;
  }
  return tax;
}

// Updated Mortgage & Deposit Metrics Calculator
function calculateMortgageMetrics(ageJoelVal) {
  const homeValue = parseCurrencyNumber(document.getElementById('mort-home-value')?.value || '1200000');
  const ltvPct = (parseFloat(document.getElementById('mort-ltv-pct')?.value) || 80) / 100;
  const annualInterestRate = (parseFloat(document.getElementById('mort-interest-rate')?.value) || 4.1) / 100;
  const termYears = parseInt(document.getElementById('mort-term-years')?.value, 10) || 25;
  const purchaseYear = parseInt(document.getElementById('mort-purchase-year')?.value, 10) || 2030;

  const initialLoan = homeValue * ltvPct;
  const baseDeposit = homeValue * (1 - ltvPct);
  const stampDuty = calculateSDLT(homeValue);
  const totalDepositIncSDLT = baseDeposit + stampDuty;

  // Update Deposit Read-Only Field (inc. Stamp Duty)
  const depEl = document.getElementById('mort-deposit-val');
  if (depEl) depEl.value = formatInputValue(totalDepositIncSDLT);

  // Monthly Mortgage Amortization Formula
  const monthlyRate = annualInterestRate / 12;
  const totalPayments = termYears * 12;

  let monthlyPayment = 0;
  if (monthlyRate > 0) {
    monthlyPayment = initialLoan * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments)) / (Math.pow(1 + monthlyRate, totalPayments) - 1);
  } else {
    monthlyPayment = initialLoan / totalPayments;
  }

  const payEl = document.getElementById('mort-monthly-payment');
  if (payEl) payEl.value = formatInputValue(monthlyPayment);

  // Outstanding Balance at Joint Retirement Date
  const joelRetireYear = 1991 + ageJoelVal;
  const totalMonthsElapsed = Math.max(0, ((joelRetireYear - purchaseYear) * 12) + (10 - 4));
  const monthsRemaining = Math.max(0, totalPayments - totalMonthsElapsed);

  let outstandingBalanceAtRetirement = 0;
  if (monthsRemaining > 0 && monthsRemaining <= totalPayments) {
    outstandingBalanceAtRetirement = initialLoan * (Math.pow(1 + monthlyRate, totalPayments) - Math.pow(1 + monthlyRate, totalMonthsElapsed)) / (Math.pow(1 + monthlyRate, totalPayments) - 1);
  }

  const balEl = document.getElementById('mort-balance-at-retirement');
  if (balEl) balEl.value = formatInputValue(outstandingBalanceAtRetirement);

  return {
    baseDeposit,
    stampDuty,
    totalDepositIncSDLT,
    monthlyPayment,
    outstandingBalanceAtRetirement,
    purchaseYear,
    joelRetireYear
  };
}

function setupRetirementInputListeners() {
  const ageJoelInput = document.getElementById('ret-age-joel');
  const ageEmmaInput = document.getElementById('ret-age-emma');
  const yearJoelSpan = document.getElementById('ret-year-joel');
  const yearEmmaSpan = document.getElementById('ret-year-emma');

  // Disable Emma input box so Joel drives the synchronized joint retirement age
  if (ageEmmaInput) {
    ageEmmaInput.disabled = true;
    ageEmmaInput.style.opacity = '0.7';
    ageEmmaInput.style.cursor = 'not-allowed';
  }

  const syncAgesAndCalculate = () => {
    const ageJoelVal = parseInt(ageJoelInput?.value, 10) || 53;
    const joelRetireYear = calculateRetirementYear('1991-10-21', ageJoelVal);

    if (yearJoelSpan) yearJoelSpan.innerText = `(${joelRetireYear})`;

    if (ageEmmaInput) {
      const emmaAgeCalculated = calculateEmmaAgeAtRetirement(joelRetireYear);
      ageEmmaInput.value = emmaAgeCalculated;
    }

    if (yearEmmaSpan) yearEmmaSpan.innerText = `(${joelRetireYear})`;

    calculateRetirementForecast();
  };

  if (ageJoelInput) {
    ageJoelInput.addEventListener('input', syncAgesAndCalculate);
  }

  // Bind live recalculation to all variable inputs
  const container = document.getElementById('retirement-variables-container');
  if (container) {
    container.querySelectorAll('input').forEach(input => {
      if (input !== ageEmmaInput) {
        input.addEventListener('input', calculateRetirementForecast);
      }
    });
  }

  // Bind live recalculation to Mortgage Inputs
  const mortContainer = document.getElementById('mortgage-variables-container');
  if (mortContainer) {
    mortContainer.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', calculateRetirementForecast);
    });
  }

  // Pre-Retirement Withdrawals Manager
  const addDrawdownBtn = document.getElementById('btn-add-drawdown');
  const drawdownsContainer = document.getElementById('drawdowns-list-container');

  if (addDrawdownBtn && drawdownsContainer) {
    drawdownsContainer.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', calculateRetirementForecast);
    });

    addDrawdownBtn.onclick = () => {
      const div = document.createElement('div');
      div.className = 'drawdown-row';
      div.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-top: 8px;';
      div.innerHTML = `
        <span>Amount: £</span>
        <input type="text" class="drawdown-amount" value="50,000.00" style="width: 140px;">
        <span>Year:</span>
        <input type="number" class="drawdown-year" value="2030" style="width: 100px;">
        <span>(April)</span>
        <button type="button" class="btn-remove-drawdown" style="background: none; border: none; color: #f87171; cursor: pointer; font-weight: bold;">✕</button>
      `;
      drawdownsContainer.appendChild(div);

      div.querySelectorAll('input').forEach(inp => inp.addEventListener('input', calculateRetirementForecast));
      
      div.querySelector('.btn-remove-drawdown').onclick = () => {
        div.remove();
        calculateRetirementForecast();
      };

      calculateRetirementForecast();
    };

    drawdownsContainer.querySelectorAll('.btn-remove-drawdown').forEach(btn => {
      btn.onclick = (e) => {
        e.target.closest('.drawdown-row').remove();
        calculateRetirementForecast();
      };
    });
  }

  // Post-Retirement Lump Sum Expenditure Manager (Section 3)
  const addPostLumpBtn = document.getElementById('btn-add-post-lump');
  const postLumpContainer = document.getElementById('post-lump-list-container');
  const monthlyExpenseInput = document.getElementById('ret-monthly-expense');

  if (monthlyExpenseInput) {
    monthlyExpenseInput.addEventListener('input', calculateRetirementForecast);
  }

  if (addPostLumpBtn && postLumpContainer) {
    postLumpContainer.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', calculateRetirementForecast);
    });

    addPostLumpBtn.onclick = () => {
      const div = document.createElement('div');
      div.className = 'post-lump-row';
      div.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-top: 8px;';
      div.innerHTML = `
        <span>Amount: £</span>
        <input type="text" class="post-lump-amount" value="20,000.00" style="width: 140px;">
        <span>Year:</span>
        <input type="number" class="post-lump-year" value="2046" style="width: 100px;">
        <button type="button" class="btn-remove-post-lump" style="background: none; border: none; color: #f87171; cursor: pointer; font-weight: bold;">✕</button>
      `;
      postLumpContainer.appendChild(div);

      div.querySelectorAll('input').forEach(inp => inp.addEventListener('input', calculateRetirementForecast));
      
      div.querySelector('.btn-remove-post-lump').onclick = () => {
        div.remove();
        calculateRetirementForecast();
      };

      calculateRetirementForecast();
    };

    postLumpContainer.querySelectorAll('.btn-remove-post-lump').forEach(btn => {
      btn.onclick = (e) => {
        e.target.closest('.post-lump-row').remove();
        calculateRetirementForecast();
      };
    });
  }

  // Initial Sync on load
  syncAgesAndCalculate();
}

// Primary Retirement Projection & Decumulation Simulation
function calculateRetirementForecast() {
  if (!baselineRetirementData.snapshotDate) {
    extractRetirementBaselineData();
  }

  const realGrowthRate = (parseFloat(document.getElementById('ret-growth-rate')?.value) || 5) / 100;
  const ageJoel = parseInt(document.getElementById('ret-age-joel')?.value, 10) || 53;

  const annualPensionJoel = parseCurrencyNumber(document.getElementById('ret-pension-joel')?.value || '40000');
  const annualPensionEmma = parseCurrencyNumber(document.getElementById('ret-pension-emma')?.value || '25000');
  const annualIsaJoel = parseCurrencyNumber(document.getElementById('ret-isa-joel')?.value || '20000');
  const annualIsaEmma = parseCurrencyNumber(document.getElementById('ret-isa-emma')?.value || '20000');

  // Calculate Mortgage Metrics
  const mortMetrics = calculateMortgageMetrics(ageJoel);

  // Parse Pre-Retirement Withdrawals
  const preWithdrawals = [];
  document.querySelectorAll('#drawdowns-list-container .drawdown-row').forEach(row => {
    const amt = parseCurrencyNumber(row.querySelector('.drawdown-amount')?.value);
    const yr = parseInt(row.querySelector('.drawdown-year')?.value, 10);
    if (amt > 0 && yr) {
      preWithdrawals.push({ amount: amt, year: yr });
    }
  });

  // Target Joint Retirement Date driven by Joel
  const jointRetireYear = 1991 + ageJoel; // October

  const baseDate = new Date(baselineRetirementData.snapshotDate);
  let currentYear = baseDate.getFullYear();
  let currentMonth = baseDate.getMonth() + 1;

  let joelIsa = baselineRetirementData.joelISA;
  let emmaIsa = baselineRetirementData.emmaISA;
  let joelPension = baselineRetirementData.joelPension;
  let emmaPension = baselineRetirementData.emmaPension;
  let totalGia = baselineRetirementData.joelGIA + baselineRetirementData.emmaGIA + baselineRetirementData.jointGIA;

  const monthlyGrowthRate = Math.pow(1 + realGrowthRate, 1 / 12) - 1;

  const accumLabels = [];
  const accumPensions = [];
  const accumIsas = [];
  const accumGias = [];
  const accumTotals = [];

  let simYear = currentYear;
  let simMonth = currentMonth;

  // --------------------------------------------------------------------------
  // PHASE 1: ACCUMULATION TO JOINT RETIREMENT DATE (OCTOBER OF RETIREMENT YEAR)
  // --------------------------------------------------------------------------
  while (simYear < jointRetireYear || (simYear === jointRetireYear && simMonth <= 10)) {
    const inTaper = simYear >= (jointRetireYear - 2);
    const effectiveGrowthRate = inTaper ? (monthlyGrowthRate * 0.3) : monthlyGrowthRate;

    // Monthly Contributions (Active up to retirement month)
    joelPension += (annualPensionJoel / 12);
    joelIsa += (annualIsaJoel / 12);
    emmaPension += (annualPensionEmma / 12);
    emmaIsa += (annualIsaEmma / 12);

    // Apply Growth
    joelPension *= (1 + effectiveGrowthRate);
    emmaPension *= (1 + effectiveGrowthRate);
    joelIsa *= (1 + effectiveGrowthRate);
    emmaIsa *= (1 + effectiveGrowthRate);
    totalGia *= (1 + effectiveGrowthRate);

    // Pre-Retirement Withdrawals (April)
    if (simMonth === 4) {
      preWithdrawals.forEach(w => {
        if (w.year === simYear) {
          let halfAmt = w.amount / 2;
          
          if (joelIsa >= halfAmt) {
            joelIsa -= halfAmt;
          } else {
            let remain = halfAmt - joelIsa;
            joelIsa = 0;
            totalGia = Math.max(0, totalGia - remain);
          }

          if (emmaIsa >= halfAmt) {
            emmaIsa -= halfAmt;
          } else {
            let remain = halfAmt - emmaIsa;
            emmaIsa = 0;
            totalGia = Math.max(0, totalGia - remain);
          }
        }
      });
    }

    // Record Data Points Yearly (Dec) or At Start/Retirement End
    if (simMonth === 12 || (simYear === jointRetireYear && simMonth === 10) || (simYear === currentYear && simMonth === currentMonth)) {
      const monthStr = simMonth < 10 ? `0${simMonth}` : `${simMonth}`;
      accumLabels.push(`${monthStr}-${String(simYear).slice(-2)}`);
      
      const aggPensions = joelPension + emmaPension;
      const aggIsas = joelIsa + emmaIsa;
      
      accumPensions.push(Math.round(aggPensions));
      accumIsas.push(Math.round(aggIsas));
      accumGias.push(Math.round(totalGia));
      accumTotals.push(Math.round(aggPensions + aggIsas + totalGia));
    }

    simMonth++;
    if (simMonth > 12) {
      simMonth = 1;
      simYear++;
    }
  }

  // Update Total Pot Badge at Retirement
  const finalAccumTotal = accumTotals[accumTotals.length - 1] || 0;
  const potBadge = document.getElementById('projected-total-pot');
  if (potBadge) potBadge.innerText = formatCurrency(finalAccumTotal);

  renderRetirementChart(accumLabels, accumPensions, accumIsas, accumGias, accumTotals);

  // --------------------------------------------------------------------------
  // PHASE 2: DECUMULATION & ESTATE LEGACY ENGINE (DAY 1 TO EMMA AGE 90)
  // --------------------------------------------------------------------------
  
  const monthlyExpenseNet = parseCurrencyNumber(document.getElementById('ret-monthly-expense')?.value || '5000');
  
  const postLumpSums = [];
  document.querySelectorAll('#post-lump-list-container .post-lump-row').forEach(row => {
    const amt = parseCurrencyNumber(row.querySelector('.post-lump-amount')?.value);
    const yr = parseInt(row.querySelector('.post-lump-year')?.value, 10);
    if (amt > 0 && yr) {
      postLumpSums.push({ amount: amt, year: yr });
    }
  });

  // DAY 1 MORTGAGE PAYOFF: Direct ISA withdrawal for outstanding balance (No pension PCLS sweep)
  const day1MortgagePayoff = mortMetrics.outstandingBalanceAtRetirement;
  let halfMortPayoff = day1MortgagePayoff / 2;

  if (joelIsa >= halfMortPayoff) {
    joelIsa -= halfMortPayoff;
  } else {
    let remain = halfMortPayoff - joelIsa;
    joelIsa = 0;
    totalGia = Math.max(0, totalGia - remain);
  }

  if (emmaIsa >= halfMortPayoff) {
    emmaIsa -= halfMortPayoff;
  } else {
    let remain = halfMortPayoff - emmaIsa;
    emmaIsa = 0;
    totalGia = Math.max(0, totalGia - remain);
  }

  // Update Day 1 Mortgage Payoff Badge in UI
  const mortPayBadge = document.getElementById('badge-mort-payoff');
  if (mortPayBadge) mortPayBadge.innerText = formatCurrency(day1MortgagePayoff);

  // Decumulation Timeline Bounds (Retirement Date -> March 2084 when Emma turns 90)
  const emmaAge90Year = 2084;
  const emmaAge90Month = 3;

  const joelAge58Year = 1991 + 58; // 2049
  const emmaAge58Year = 1994 + 58; // 2052

  const decLabels = [];
  const decPensions = [];
  const decIsas = [];
  const decGias = [];
  const decTotals = [];

  // Annual Drawdowns tracking for Bar Chart
  const annualDrawdownYears = [];
  const annualDrawdownAmounts = [];
  let currentYearDrawdownSum = day1MortgagePayoff; // Initialize Year 1 with Day 1 mortgage payoff

  // Record Day 1 Initial State Post-Mortgage Payoff
  decLabels.push(`10-${String(jointRetireYear).slice(-2)}`);
  decPensions.push(Math.round(joelPension + emmaPension));
  decIsas.push(Math.round(joelIsa + emmaIsa));
  decGias.push(Math.round(totalGia));
  decTotals.push(Math.round(joelPension + emmaPension + joelIsa + emmaIsa + totalGia));

  // Advance simulation past retirement month
  simMonth++;
  if (simMonth > 12) {
    simMonth = 1;
    simYear++;
  }

  // Blended post-retirement growth rate (50% full growth, 50% half growth = 75% effective)
  const blendedAnnualRate = realGrowthRate * 0.75;
  const monthlyDecumulationRate = Math.pow(1 + blendedAnnualRate, 1 / 12) - 1;

  while (simYear < emmaAge90Year || (simYear === emmaAge90Year && simMonth <= emmaAge90Month)) {
    // Apply blended post-retirement growth rate across remaining portfolios
    joelPension *= (1 + monthlyDecumulationRate);
    emmaPension *= (1 + monthlyDecumulationRate);
    joelIsa *= (1 + monthlyDecumulationRate);
    emmaIsa *= (1 + monthlyDecumulationRate);
    totalGia *= (1 + monthlyDecumulationRate);

    // Minimum pension age availability flag (Age 58)
    const joelPensionAccessible = (simYear > joelAge58Year) || (simYear === joelAge58Year && simMonth >= 10);
    const emmaPensionAccessible = (simYear > emmaAge58Year) || (simYear === emmaAge58Year && simMonth >= 3);
    const pensionsAccessible = joelPensionAccessible || emmaPensionAccessible;

    // Monthly Living Expense Drawdown Logic
    if (pensionsAccessible && (joelPension + emmaPension > 0)) {
      // 20% basic rate tax gross-up on pension drawdown
      const grossMonthlyDraw = monthlyExpenseNet / 0.8;
      let halfGross = grossMonthlyDraw / 2;

      currentYearDrawdownSum += grossMonthlyDraw;

      // Draw from Joel Pension
      if (joelPension >= halfGross) {
        joelPension -= halfGross;
      } else {
        let remainGross = halfGross - joelPension;
        joelPension = 0;
        emmaPension = Math.max(0, emmaPension - remainGross);
      }

      // Draw from Emma Pension
      if (emmaPension >= halfGross) {
        emmaPension -= halfGross;
      } else {
        let remainGross = halfGross - emmaPension;
        emmaPension = 0;
        joelPension = Math.max(0, joelPension - remainGross);
      }
    } else {
      // Bridge Phase (Pre-58): Draw tax-free from ISAs then GIAs
      let halfNet = monthlyExpenseNet / 2;
      currentYearDrawdownSum += monthlyExpenseNet;

      if (joelIsa >= halfNet) {
        joelIsa -= halfNet;
      } else {
        let remain = halfNet - joelIsa;
        joelIsa = 0;
        totalGia = Math.max(0, totalGia - remain);
      }

      if (emmaIsa >= halfNet) {
        emmaIsa -= halfNet;
      } else {
        let remain = halfNet - emmaIsa;
        emmaIsa = 0;
        totalGia = Math.max(0, totalGia - remain);
      }
    }

    // Post-Retirement Lump Sum Expenditures (April)
    if (simMonth === 4) {
      postLumpSums.forEach(ls => {
        if (ls.year === simYear) {
          let halfLump = ls.amount / 2;
          currentYearDrawdownSum += ls.amount;

          if (joelIsa >= halfLump) {
            joelIsa -= halfLump;
          } else {
            let remain = halfLump - joelIsa;
            joelIsa = 0;
            totalGia = Math.max(0, totalGia - remain);
          }

          if (emmaIsa >= halfLump) {
            emmaIsa -= halfLump;
          } else {
            let remain = halfLump - emmaIsa;
            emmaIsa = 0;
            totalGia = Math.max(0, totalGia - remain);
          }
        }
      });
    }

    // Record Data Points Yearly (Dec) or At Timeline End
    if (simMonth === 12 || (simYear === emmaAge90Year && simMonth === emmaAge90Month)) {
      const yearDiff = simYear - jointRetireYear;
      
      // Filter X-Axis ticks to 2-Year Increments starting from retirement year
      if (yearDiff % 2 === 0 || (simYear === emmaAge90Year && simMonth === emmaAge90Month)) {
        const monthStr = simMonth < 10 ? `0${simMonth}` : `${simMonth}`;
        decLabels.push(`${monthStr}-${String(simYear).slice(-2)}`);

        const aggPensions = joelPension + emmaPension;
        const aggIsas = joelIsa + emmaIsa;

        decPensions.push(Math.round(aggPensions));
        decIsas.push(Math.round(aggIsas));
        decGias.push(Math.round(totalGia));
        decTotals.push(Math.round(aggPensions + aggIsas + totalGia));
      }

      // Record Annual Drawdown Totals for Bar Chart
      annualDrawdownYears.push(`${simYear}`);
      annualDrawdownAmounts.push(Math.round(currentYearDrawdownSum));
      currentYearDrawdownSum = 0; // Reset for next simulation year
    }

    simMonth++;
    if (simMonth > 12) {
      simMonth = 1;
      simYear++;
    }
  }

  // Update Estate Legacy Badge at Age 90
  const finalLegacyTotal = decTotals[decTotals.length - 1] || 0;
  const legacyBadge = document.getElementById('projected-legacy-pot');
  if (legacyBadge) legacyBadge.innerText = formatCurrency(finalLegacyTotal);

  renderDecumulationChart(decLabels, decPensions, decIsas, decGias, decTotals);
  renderAnnualDrawdownChart(annualDrawdownYears, annualDrawdownAmounts);
}

// Render Accumulation Forecast Chart
function renderRetirementChart(labels, pensions, isas, gias, totals) {
  const ctx = document.getElementById('retirementChart')?.getContext('2d');
  if (!ctx) return;

  if (retirementChart) {
    retirementChart.destroy();
  }

  retirementChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: 'Pensions', data: pensions, borderColor: '#38bdf8', backgroundColor: '#38bdf8', fill: false, tension: 0.2, pointRadius: 3 },
        { label: 'ISAs', data: isas, borderColor: '#34d399', backgroundColor: '#34d399', fill: false, tension: 0.2, pointRadius: 3 },
        { label: 'GIAs', data: gias, borderColor: '#fbbf24', backgroundColor: '#fbbf24', fill: false, tension: 0.2, pointRadius: 3 },
        { label: 'Total Portfolio', data: totals, borderColor: '#a855f7', backgroundColor: '#a855f7', fill: false, borderDash: [5, 5], tension: 0.2, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { 
        padding: { top: 50, right: 25, bottom: 20, left: 15 } 
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#f8fafc',
          font: { weight: 'bold', size: 12 },
          formatter: (val) => formatCompactCurrency(val)
        },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` }
        }
      },
      scales: {
        x: {
          ticks: { color: '#cbd5e1' },
          grid: { color: '#334155' }
        },
        y: {
          display: true,
          beginAtZero: true,
          ticks: {
            color: '#94a3b8',
            font: { size: 12 },
            callback: (val) => formatCompactCurrency(val)
          },
          grid: { color: '#1e293b' }
        }
      }
    }
  });

  document.querySelectorAll('.ret-series-toggle').forEach(cb => {
    const idx = parseInt(cb.getAttribute('data-dataset'), 10);
    retirementChart.setDatasetVisibility(idx, cb.checked);
  });
  
  retirementChart.update();
}

// Render Decumulation & Estate Legacy Chart (Line Chart with 2-Year Increments)
function renderDecumulationChart(labels, pensions, isas, gias, totals) {
  const ctx = document.getElementById('decumulationChart')?.getContext('2d');
  if (!ctx) return;

  if (decumulationChart) {
    decumulationChart.destroy();
  }

  decumulationChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: 'Pensions', data: pensions, borderColor: '#38bdf8', backgroundColor: '#38bdf8', fill: false, tension: 0.2, pointRadius: 3 },
        { label: 'ISAs / Cash', data: isas, borderColor: '#34d399', backgroundColor: '#34d399', fill: false, tension: 0.2, pointRadius: 3 },
        { label: 'GIAs', data: gias, borderColor: '#fbbf24', backgroundColor: '#fbbf24', fill: false, tension: 0.2, pointRadius: 3 },
        { label: 'Remaining Portfolio', data: totals, borderColor: '#a855f7', backgroundColor: '#a855f7', fill: false, borderDash: [5, 5], tension: 0.2, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { 
        padding: { top: 50, right: 25, bottom: 20, left: 15 } 
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#f8fafc',
          font: { weight: 'bold', size: 11 },
          formatter: (val) => formatCompactCurrency(val)
        },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` }
        }
      },
      scales: {
        x: {
          ticks: { color: '#cbd5e1', font: { size: 11 } },
          grid: { color: '#334155' }
        },
        y: {
          display: true,
          beginAtZero: true,
          ticks: {
            color: '#94a3b8',
            font: { size: 12 },
            callback: (val) => formatCompactCurrency(val)
          },
          grid: { color: '#1e293b' }
        }
      }
    }
  });

  document.querySelectorAll('.dec-series-toggle').forEach(cb => {
    const idx = parseInt(cb.getAttribute('data-dataset'), 10);
    decumulationChart.setDatasetVisibility(idx, cb.checked);
  });
  
  decumulationChart.update();
}

// Render Annual Total Drawdowns Bar Chart (Below Section 3 Main Chart)
function renderAnnualDrawdownChart(years, amounts) {
  const ctx = document.getElementById('annualDrawdownChart')?.getContext('2d');
  if (!ctx) return;

  if (annualDrawdownChart) {
    annualDrawdownChart.destroy();
  }

  annualDrawdownChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        {
          label: 'Total Annual Drawdown',
          data: amounts,
          backgroundColor: amounts.map((amt, idx) => idx === 0 ? '#f87171' : '#38bdf8'),
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { 
        padding: { top: 35, right: 25, bottom: 10, left: 15 } 
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#f8fafc',
          font: { weight: 'bold', size: 10 },
          formatter: (val) => formatCompactCurrency(val)
        },
        tooltip: {
          callbacks: { label: (ctx) => `Annual Drawdown: ${formatCurrency(ctx.raw)}` }
        }
      },
      scales: {
        x: {
          ticks: { color: '#cbd5e1', font: { size: 10 } },
          grid: { color: '#1e293b' }
        },
        y: {
          display: true,
          beginAtZero: true,
          ticks: {
            color: '#94a3b8',
            font: { size: 11 },
            callback: (val) => formatCompactCurrency(val)
          },
          grid: { color: '#1e293b' }
        }
      }
    }
  });
}