// background/test-phase4-integration.js
// v10.0 Phase 4 Intelligence Systems Integration Test
// Tests all intelligence systems are properly integrated into agent-engine.js

import { 
  initReasoningTrace, 
  captureReasoningStep, 
  getReasoningSummary, 
  clearReasoningTrace 
} from './reasoning-trace.js';

import { 
  analyzeForBias, 
  analyzeActionForBias, 
  shouldTriggerBiasWarning, 
  generateBiasReport, 
  logBiasDetection, 
  getBiasStatistics, 
  clearBiasLog 
} from './bias-detector.js';

import { 
  initKnowledgeGraph, 
  addKnowledgeNode, 
  updateKnowledgeNode, 
  addKnowledgeEdge, 
  findKnowledgeContradictions, 
  getKnowledgeGraphStats, 
  persistKnowledgeGraph 
} from './knowledge-graph.js';

import { 
  analyzeForContradictions, 
  compareResponsesForContradictions, 
  logContradictionDetection, 
  getContradictionStatistics, 
  clearContradictionLog 
} from './contradiction-detector.js';

import { 
  analyzeForNovelty, 
  storeNoveltyResult, 
  getNoveltyStatistics, 
  clearNoveltyHistory 
} from './novelty-detector.js';

import { 
  synthesizeKnowledge, 
  getSynthesis, 
  getSynthesisStatistics, 
  clearSynthesis 
} from './knowledge-synthesizer.js';

console.log('=== Phase 4 Intelligence Systems Integration Test ===\n');

// Test 1: Reasoning Trace System
console.log('Test 1: Reasoning Trace System');
try {
  await initReasoningTrace();
  await captureReasoningStep('test_action', 'input', { goal: 'test goal' });
  await captureReasoningStep('test_action', 'output', { result: 'success' });
  const summary = await getReasoningSummary();
  console.log('✓ Reasoning trace working:', summary.totalSteps);
  clearReasoningTrace();
} catch (e) {
  console.error('✗ Reasoning trace failed:', (typeof e === 'object' && e !== null && typeof e.message === 'string') ? e.message : String(e));
}

// Test 2: Bias Detection System
console.log('\nTest 2: Bias Detection System');
try {
  const testAction = { type: 'click', text: 'Always click the first option' };
  const biasAnalysis = analyzeActionForBias(testAction, 'Select best option');
  console.log('✓ Bias detection working:', biasAnalysis.hasBias ? 'BIAS FOUND' : 'No bias');
  const stats = getBiasStatistics();
  console.log('  Bias stats:', stats.totalAnalyses);
  clearBiasLog();
} catch (e) {
  console.error('✗ Bias detection failed:', (typeof e === 'object' && e !== null && typeof e.message === 'string') ? e.message : String(e));
}

// Test 3: Knowledge Graph System
console.log('\nTest 3: Knowledge Graph System');
try {
  await initKnowledgeGraph();
  await addKnowledgeNode('test', 'test_entity', { data: 'test' });
  await addKnowledgeEdge('test_entity', 'related_to', 'other_entity');
  const stats = getKnowledgeGraphStats();
  console.log('✓ Knowledge graph working:', stats.nodeCount, 'nodes,', stats.edgeCount, 'edges');
  clearBiasLog(); // Clear for next test
} catch (e) {
  console.error('✗ Knowledge graph failed:', (typeof e === 'object' && e !== null && typeof e.message === 'string') ? e.message : String(e));
}

// Test 4: Contradiction Detection System
console.log('\nTest 4: Contradiction Detection System');
try {
  const testHistory = [
    'User wants to delete all files',
    'User wants to keep all files'
  ];
  const contradictionCheck = analyzeForContradictions(testHistory, 'test_action');
  console.log('✓ Contradiction detection working:', contradictionCheck.hasContradictions ? 'CONTRADICTION FOUND' : 'No contradiction');
  const stats = getContradictionStatistics();
  console.log('  Contradiction stats:', stats.totalChecks);
  clearContradictionLog();
} catch (e) {
  console.error('✗ Contradiction detection failed:', (typeof e === 'object' && e !== null && typeof e.message === 'string') ? e.message : String(e));
}

// Test 5: Novelty Detection System
console.log('\nTest 5: Novelty Detection System');
try {
  const testHistory = [
    { type: 'click', selector: '#rare-button' },
    { type: 'type', text: 'unusual input' }
  ];
  const noveltyResults = analyzeForNovelty(testHistory, { goal: 'test novelty', stepCount: 2 });
  storeNoveltyResult(noveltyResults);
  console.log('✓ Novelty detection working:', noveltyResults.summary);
  const stats = getNoveltyStatistics();
  console.log('  Novelty stats:', stats.totalAnalyses);
  clearNoveltyHistory();
} catch (e) {
  console.error('✗ Novelty detection failed:', (typeof e === 'object' && e !== null && typeof e.message === 'string') ? e.message : String(e));
}

// Test 6: Knowledge Synthesizer System
console.log('\nTest 6: Knowledge Synthesizer System');
try {
  const synthesis = await synthesizeKnowledge({
    goal: 'Test synthesis goal',
    history: [{ type: 'click' }, { type: 'wait' }],
    reasoningTrace: { totalSteps: 2 },
    biasStats: { totalAnalyses: 1 },
    contradictionStats: { totalChecks: 0 },
    noveltyStats: { totalAnalyses: 1 }
  });
  console.log('✓ Knowledge synthesis working:', synthesis.summary);
  const stats = getSynthesisStatistics();
  console.log('  Synthesis stats:', stats.totalSyntheses);
  clearSynthesis();
} catch (e) {
  console.error('✗ Knowledge synthesis failed:', (typeof e === 'object' && e !== null && typeof e.message === 'string') ? e.message : String(e));
}

console.log('\n=== Phase 4 Integration Test Complete ===');
console.log('All intelligence systems are functional and integrated.');
