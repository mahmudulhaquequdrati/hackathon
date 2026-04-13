/**
 * M7: Predictive Route Decay Service
 * Manages rainfall data ingestion, feature engineering, and proactive rerouting.
 */

const { getDb } = require('../db/connection');
const { predictEdgeRisk, evaluateModel } = require('./classifier');

// Ensure rainfall_data table exists
function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS rainfall_data (
      id TEXT PRIMARY KEY,
      edge_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      rainfall_mm REAL NOT NULL DEFAULT 0,
      rate_of_change REAL NOT NULL DEFAULT 0,
      cumulative_mm REAL NOT NULL DEFAULT 0,
      elevation REAL DEFAULT 50,
      soil_saturation REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * M7.1: Ingest rainfall data with feature engineering
 * @param {Array} records - [{ edge_id, rainfall_mm, timestamp? }]
 * @returns {{ ingested: number, features_computed: number }}
 */
function ingestRainfall(records) {
  ensureTable();
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO rainfall_data (id, edge_id, timestamp, rainfall_mm, rate_of_change, cumulative_mm, elevation, soil_saturation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let ingested = 0;
  const DRAINAGE_CONSTANT = 200; // mm - how much rain before saturation = 1.0

  for (const record of records) {
    const edgeId = record.edge_id;
    const rainfallMm = record.rainfall_mm || 0;
    const timestamp = record.timestamp || new Date().toISOString();
    const id = `rain-${edgeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Get previous data for this edge to compute features
    const prev = db.prepare(
      'SELECT cumulative_mm, rainfall_mm FROM rainfall_data WHERE edge_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(edgeId);

    const prevCumulative = prev ? prev.cumulative_mm : 0;
    const prevRainfall = prev ? prev.rainfall_mm : 0;
    const cumulativeMm = prevCumulative + rainfallMm;
    const rateOfChange = rainfallMm - prevRainfall;

    // Get edge elevation from edges table (use risk_score as proxy for low elevation)
    const edge = db.prepare('SELECT risk_score FROM edges WHERE id = ?').get(edgeId);
    const elevation = edge ? Math.max(10, 100 - edge.risk_score * 100) : 50;

    // Soil saturation proxy: cumulative / drainage constant, capped at 1.0
    const soilSaturation = Math.min(1.0, cumulativeMm / DRAINAGE_CONSTANT);

    insert.run(id, edgeId, timestamp, rainfallMm, rateOfChange, cumulativeMm, elevation, soilSaturation);
    ingested++;
  }

  return { ingested, features_computed: ingested };
}

/**
 * M7.2 + M7.4: Get risk predictions for all edges
 * @returns {Object} { edges: { [edgeId]: { probability, features, predicted_at } }, high_risk_count, model_metrics }
 */
function getRiskMap() {
  ensureTable();
  const db = getDb();
  const edges = db.prepare('SELECT * FROM edges').all();
  const riskMap = {};
  let highRiskCount = 0;

  for (const edge of edges) {
    // Get latest rainfall data for this edge
    const latest = db.prepare(
      'SELECT * FROM rainfall_data WHERE edge_id = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(edge.id);

    const features = {
      cumulative_rainfall_mm: latest ? latest.cumulative_mm : 0,
      rate_of_change: latest ? latest.rate_of_change : 0,
      elevation: latest ? latest.elevation : (100 - edge.risk_score * 100),
      soil_saturation: latest ? latest.soil_saturation : 0,
      current_risk_score: edge.risk_score,
    };

    const prediction = predictEdgeRisk(features);
    riskMap[edge.id] = prediction;

    if (prediction.probability > 0.7) highRiskCount++;
  }

  return {
    edges: riskMap,
    high_risk_count: highRiskCount,
    total_edges: edges.length,
    model_metrics: evaluateModel(),
    evaluated_at: new Date().toISOString(),
  };
}

/**
 * Get risk prediction for a specific edge
 */
function getEdgeRisk(edgeId) {
  ensureTable();
  const db = getDb();

  const edge = db.prepare('SELECT * FROM edges WHERE id = ?').get(edgeId);
  if (!edge) return null;

  const latest = db.prepare(
    'SELECT * FROM rainfall_data WHERE edge_id = ? ORDER BY timestamp DESC LIMIT 1'
  ).get(edgeId);

  const history = db.prepare(
    'SELECT * FROM rainfall_data WHERE edge_id = ? ORDER BY timestamp DESC LIMIT 10'
  ).all(edgeId);

  const features = {
    cumulative_rainfall_mm: latest ? latest.cumulative_mm : 0,
    rate_of_change: latest ? latest.rate_of_change : 0,
    elevation: latest ? latest.elevation : (100 - edge.risk_score * 100),
    soil_saturation: latest ? latest.soil_saturation : 0,
    current_risk_score: edge.risk_score,
  };

  const prediction = predictEdgeRisk(features);

  return {
    edge_id: edgeId,
    edge_type: edge.type,
    edge_status: edge.status,
    ...prediction,
    history: history.map(h => ({
      timestamp: h.timestamp,
      rainfall_mm: h.rainfall_mm,
      cumulative_mm: h.cumulative_mm,
      soil_saturation: h.soil_saturation,
    })),
  };
}

module.exports = {
  ingestRainfall,
  getRiskMap,
  getEdgeRisk,
  ensureTable,
};
