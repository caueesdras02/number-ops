import { SCHEMA_VERSION } from "../config/constants.js";
export function createInitialState() { return { schemaVersion: SCHEMA_VERSION, numbers: [], clients: [], groups: [], responsibles: [], locations: [], incidents: [], historyEvents: [] }; }
