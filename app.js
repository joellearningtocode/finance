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
  setupRetirementSeriesFilterListeners(); // Cleanly registered here

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

// Setup Series Toggle Listeners for Retirement Chart
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

function setupRetirementInputListeners() {
  const ageJoelInput = document.getElementById('ret-age-joel');
  const ageEmmaInput = document.getElementById('ret-age-emma');
  const yearJoelSpan = document.getElementById('ret-year-joel');
  const yearEmmaSpan = document.getElementById('ret-year-emma');

  if (ageJoelInput && yearJoelSpan) {
    ageJoelInput.addEventListener('input', (e) => {
      const year = calculateRetirementYear('1991-10-21', e.target.value || 53);
      yearJoelSpan.innerText = `(${year})`;
      calculateRetirementForecast();
    });
  }

  if (ageEmmaInput && yearEmmaSpan) {
    ageEmmaInput.addEventListener('input', (e) => {
      const year = calculateRetirementYear('1994-03-25', e.target.value || 51);
      yearEmmaSpan.innerText = `(${year})`;
      calculateRetirementForecast();
    });
  }

  const container = document.getElementById('retirement-variables-container');
  if (container) {
    container.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', calculateRetirementForecast);
    });
  }

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
}

let retirementChart = null;

function calculateRetirementForecast() {
  if (!baselineRetirementData.snapshotDate) {
    extractRetirementBaselineData();
  }

  const realGrowthRate = (parseFloat(document.getElementById('ret-growth-rate')?.value) || 5) / 100;
  const ageJoel = parseInt(document.getElementById('ret-age-joel')?.value, 10) || 53;
  const ageEmma = parseInt(document.getElementById('ret-age-emma')?.value, 10) || 51;

  const annualPensionJoel = parseCurrencyNumber(document.getElementById('ret-pension-joel')?.value || '40000');
  const annualPensionEmma = parseCurrencyNumber(document.getElementById('ret-pension-emma')?.value || '25000');
  const annualIsaJoel = parseCurrencyNumber(document.getElementById('ret-isa-joel')?.value || '20000');
  const annualIsaEmma = parseCurrencyNumber(document.getElementById('ret-isa-emma')?.value || '20000');

  const drawdowns = [];
  document.querySelectorAll('#drawdowns-list-container .drawdown-row').forEach(row => {
    const amt = parseCurrencyNumber(row.querySelector('.drawdown-amount')?.value);
    const yr = parseInt(row.querySelector('.drawdown-year')?.value, 10);
    if (amt > 0 && yr) {
      drawdowns.push({ amount: amt, year: yr });
    }
  });

  const joelRetireYear = 1991 + ageJoel;
  const emmaRetireYear = 1994 + ageEmma;

  const baseDate = new Date(baselineRetirementData.snapshotDate);
  let currentYear = baseDate.getFullYear();
  let currentMonth = baseDate.getMonth() + 1;

  const finalYear = Math.max(joelRetireYear, emmaRetireYear);
  const finalMonth = 3; 

  let joelIsa = baselineRetirementData.joelISA;
  let emmaIsa = baselineRetirementData.emmaISA;
  let joelPension = baselineRetirementData.joelPension;
  let emmaPension = baselineRetirementData.emmaPension;
  let totalGia = baselineRetirementData.joelGIA + baselineRetirementData.emmaGIA + baselineRetirementData.jointGIA;

  const monthlyGrowthRate = Math.pow(1 + realGrowthRate, 1 / 12) - 1;

  const chartLabels = [];
  const pensionSeries = [];
  const isaSeries = [];
  const giaSeries = [];
  const totalSeries = [];

  let simYear = currentYear;
  let simMonth = currentMonth;

  while (simYear < finalYear || (simYear === finalYear && simMonth <= finalMonth)) {
    const joelInTaper = simYear >= (joelRetireYear - 2) && (simYear < joelRetireYear || (simYear === joelRetireYear && simMonth <= 10));
    const emmaInTaper = simYear >= (emmaRetireYear - 2) && (simYear < emmaRetireYear || (simYear === emmaRetireYear && simMonth <= 3));

    const joelRate = joelInTaper ? (monthlyGrowthRate * 0.3) : monthlyGrowthRate;
    const emmaRate = emmaInTaper ? (monthlyGrowthRate * 0.3) : monthlyGrowthRate;

    const joelActive = simYear < joelRetireYear || (simYear === joelRetireYear && simMonth <= 10);
    const emmaActive = simYear < emmaRetireYear || (simYear === emmaRetireYear && simMonth <= 3);

    if (joelActive) {
      joelPension += (annualPensionJoel / 12);
      joelIsa += (annualIsaJoel / 12);
    }
    if (emmaActive) {
      emmaPension += (annualPensionEmma / 12);
      emmaIsa += (annualIsaEmma / 12);
    }

    joelPension *= (1 + joelRate);
    emmaPension *= (1 + emmaRate);
    joelIsa *= (1 + joelRate);
    emmaIsa *= (1 + emmaRate);
    totalGia *= (1 + Math.max(joelRate, emmaRate));

    if (simMonth === 4) {
      drawdowns.forEach(d => {
        if (d.year === simYear) {
          let halfAmt = d.amount / 2;
          
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

    if (simMonth === 12 || (simYear === finalYear && simMonth === finalMonth) || (simYear === currentYear && simMonth === currentMonth)) {
      const monthStr = simMonth < 10 ? `0${simMonth}` : `${simMonth}`;
      chartLabels.push(`${monthStr}-${String(simYear).slice(-2)}`);
      
      const aggPensions = joelPension + emmaPension;
      const aggIsas = joelIsa + emmaIsa;
      
      pensionSeries.push(Math.round(aggPensions));
      isaSeries.push(Math.round(aggIsas));
      giaSeries.push(Math.round(totalGia));
      totalSeries.push(Math.round(aggPensions + aggIsas + totalGia));
    }

    simMonth++;
    if (simMonth > 12) {
      simMonth = 1;
      simYear++;
    }
  }

  const finalTotal = totalSeries[totalSeries.length - 1] || 0;
  const potBadge = document.getElementById('projected-total-pot');
  if (potBadge) potBadge.innerText = formatCurrency(finalTotal);

  renderRetirementChart(chartLabels, pensionSeries, isaSeries, giaSeries, totalSeries);
}

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
      layout: { padding: { top: 35, right: 25, bottom: 10, left: 15 } },
      plugins: {
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#f8fafc',
          font: { weight: 'bold', size: 11 },
          formatter: (val) => formatCompactCurrency(val)
        },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` }
        },
        legend: {
          labels: { color: '#cbd5e1', font: { size: 13, weight: '600' }, padding: 15 }
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