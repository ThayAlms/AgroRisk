const { listInsurancePortfolioRecords, listMachines } = require('./db');
const { prepareFleetMachine } = require('./fleet');

const PRIORITY = { ALTO: 3, MEDIO: 2, BAIXO: 1, SEM_SINAL: 0 };

async function buildSompoPortfolio() {
  const [{ customers, policies, claims, risks }, machines] = await Promise.all([
    listInsurancePortfolioRecords(),
    listMachines(),
  ]);
  const fleet = machines.map((machine) => prepareFleetMachine(machine));
  const policyByCustomer = new Map(policies.map((policy) => [policy.customerId, policy]));
  const snapshotByCustomer = new Map(risks.map((risk) => [risk.customerId, risk]));

  const contractors = customers.map((customer) => {
    const customerFleet = fleet.filter((machine) => machine.customerId === customer.id);
    const liveRisks = customerFleet.filter((machine) => machine.risk.level !== 'SEM_SINAL').map((machine) => machine.risk);
    const liveRisk = liveRisks.sort((a, b) => (PRIORITY[b.level] - PRIORITY[a.level]) || ((b.score || 0) - (a.score || 0)))[0];
    const snapshot = snapshotByCustomer.get(customer.id) || { score: null, level: 'SEM_SINAL', reason: 'Sem dados de risco disponíveis.' };
    const risk = liveRisk ? { ...liveRisk, source: 'telemetry-live' } : { ...snapshot, source: 'portfolio-snapshot' };
    const customerClaims = claims.filter((claim) => claim.customerId === customer.id && claim.status !== 'settled');
    const policy = policyByCustomer.get(customer.id) || null;
    return {
      ...customer,
      policy,
      risk,
      machineCount: customerFleet.length,
      onlineMachines: customerFleet.filter((machine) => machine.online).length,
      openClaims: customerClaims.length,
      estimatedLoss: customerClaims.reduce((total, claim) => total + claim.loss, 0),
    };
  }).sort((a, b) => (PRIORITY[b.risk.level] - PRIORITY[a.risk.level]) || ((b.risk.score || 0) - (a.risk.score || 0)));

  const activePolicies = policies.filter((policy) => policy.status === 'active');
  const openClaims = claims.filter((claim) => claim.status !== 'settled');
  const exposure = activePolicies.reduce((total, policy) => total + policy.insured, 0);
  const premium = activePolicies.reduce((total, policy) => total + policy.premium, 0);
  const estimatedLoss = openClaims.reduce((total, claim) => total + claim.loss, 0);
  const riskLevels = ['ALTO', 'MEDIO', 'BAIXO', 'SEM_SINAL'];
  const distribution = Object.fromEntries(riskLevels.map((level) => [level, contractors.filter((item) => item.risk.level === level).length]));
  const exposureByRisk = Object.fromEntries(riskLevels.map((level) => [level, contractors.filter((item) => item.risk.level === level).reduce((total, item) => total + (item.policy?.insured || 0), 0)]));

  return {
    generatedAt: new Date().toISOString(),
    demoData: true,
    summary: {
      activeContractors: contractors.filter((item) => item.status === 'active').length,
      exposure,
      annualPremium: premium,
      openClaims: openClaims.length,
      estimatedLoss,
      highRiskContractors: distribution.ALTO,
      lossToPremiumPercent: premium ? estimatedLoss / premium * 100 : 0,
    },
    distribution,
    exposureByRisk,
    contractors,
    claims: openClaims.map((claim) => ({ ...claim, customerName: customers.find((customer) => customer.id === claim.customerId)?.name || claim.customerId })),
  };
}

module.exports = { buildSompoPortfolio };
