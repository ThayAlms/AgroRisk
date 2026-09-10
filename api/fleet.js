const { listMachines } = require('../lib/db');
const { prepareFleetMachine, sortFleet, summarizeFleet } = require('../lib/fleet');
const { json, method } = require('../lib/http');

module.exports = async (request, response) => {
  if (!method(request, response, ['GET'])) return;
  try {
    const machines = sortFleet((await listMachines()).filter((machine) => machine.active !== false).map((machine) => prepareFleetMachine(machine)));
    json(response, 200, { summary: summarizeFleet(machines), machines });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
};
