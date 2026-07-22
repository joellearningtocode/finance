const SUPABASE_URL = 'https://myckufuzjvgicpiphegj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_lLMnno1aBCnV96JDZkT6ug_sZgolKaF';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

if (window.ChartDataLabels) {
  Chart.register(ChartDataLabels);
}

let assetClasses = [];
let currentValues = {};
let snapshots = [];
let historyChart = null;

// Currency Helpers
function formatCurrency(val) {
  const num = parseFloat(val) || 0;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
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

// 1. App Startup with Auth Check
async function initApp() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (session) {
    showDashboard();
  } else {
    showLogin();
  }

  // Listen for auth state changes
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (session) showDashboard();
    else showLogin();
  });

  // Attach auth listeners
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

  await fetchAssetClasses();
  await fetchLatestValues();
  await fetchSnapshots();
  
  renderInputForms();
  calculateAndDisplayNetWorth();
  renderHistoryChart();
  calculateGrowthPercentages();

  document.getElementById('save-values-btn')?.addEventListener('click', saveMonthlySnapshot);
}

// 2. Auth Handlers
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
    const rawStr = input ? input.value : (currentValues[ac.id] || 0);
    const val = parseCurrencyNumber(rawStr);

    if (ac.is_liability) {
      liquid -= val;
    } else if (ac.is_liquid) {
      liquid += val;
    } else {
      nonLiquid += val;
    }
  });

  const total = liquid + nonLiquid;

  document.getElementById('total-net-worth').innerText = formatCurrency(total);
  document.getElementById('liquid-net-worth').innerText = formatCurrency(liquid);
  document.getElementById('non-liquid-net-worth').innerText = formatCurrency(nonLiquid);

  return { total, liquid, nonLiquid };
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

    alert('Entry saved successfully!');
    await fetchSnapshots();
    renderHistoryChart();
    calculateGrowthPercentages();
  } catch (err) {
    console.error('Save failed:', err);
    alert('Failed to save entry.');
  } finally {
    btn.innerText = 'Save Monthly Entry';
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
    const dateObj = new Date(s.snapshot_date);
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = String(dateObj.getFullYear()).slice(-2);
    return `${month}-${year}`;
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
        { label: 'Total Net Worth', data: totalData, borderColor: '#2563eb', backgroundColor: '#2563eb', fill: false, tension: 0.2 },
        { label: 'Liquid Net Worth', data: liquidData, borderColor: '#059669', backgroundColor: '#059669', fill: false, tension: 0.2 },
        { label: 'Non-Liquid Net Worth', data: nonLiquidData, borderColor: '#d97706', backgroundColor: '#d97706', fill: false, tension: 0.2 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 25, right: 20 } },
      plugins: {
        datalabels: {
          anchor: 'end',
          align: 'top',
          color: '#1e293b',
          font: { weight: 'bold', size: 10 },
          formatter: (value) => formatCurrency(value)
        },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` }
        }
      },
      scales: {
        y: { ticks: { callback: (v) => formatCurrency(v) } }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initApp);