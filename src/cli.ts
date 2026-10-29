import { AiCoreSystem } from './core/index.ts';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  console.log('====================================================');
  console.log('🤖 HINGA AI CORE SYSTEM (MISSION 001 WORKBENCH)');
  console.log('====================================================\n');

  const system = await AiCoreSystem.initialize();

  switch (command) {
    case 'status': {
      console.log('🔍 INAKAGUA AFYA YA MIFUMO YOTE 8 YA NDANI...');
      const health = await system.getHealthReport();
      const identity = system.identity.getIdentity();

      console.log(`\n📋 Utambulisho: ${identity.name} (${identity.role})`);
      console.log(`🏷️ Toleo la Mfumo: v${identity.version}`);
      console.log(`🌐 Hifadhi ya Memory: ${system.isPersistentNeon ? 'Neon PostgreSQL (Imeunganishwa)' : 'In-Memory Sandbox'}`);
      console.log(`⚡ Mtoa Huduma wa AI: ${system.provider.name}`);

      console.log('\n📊 Hali ya Moduli:');
      for (const [subsystem, info] of Object.entries(health.subsystems)) {
        console.log(`  ✓ [${subsystem.toUpperCase()}]: ${JSON.stringify(info)}`);
      }

      console.log('\n🛡️ Kanuni za Maadili (Constitutional Rules):');
      for (const rule of identity.ethicalRules) {
        console.log(`  - [${rule.id}]: ${rule.rule}`);
      }
      break;
    }

    case 'task': {
      const prompt = args[1] || 'Tengeneza mpango wa kuzuia kupoteza data wakati wa kuboresha mfumo wa AI';
      console.log(`🚀 INATEKELEZA KAZI YA KIUCHAMBUZI:\n"${prompt}"\n`);

      const task = await system.orchestrator.executeTask(prompt);

      console.log(`✅ Hali ya Kazi: ${task.status.toUpperCase()} (Jukumu lililoteuliwa: ${task.assignedRole})`);
      if (task.error) {
        console.log(`⚠️ Sababu ya Hitilafu: ${task.error}`);
      }
      if (task.reasoning) {
        console.log('\n🧠 Hatua za Kufikiri (Reasoning Steps):');
        for (const step of task.reasoning.steps) {
          console.log(`  Hatua ${step.stepNumber}: ${step.action}`);
          console.log(`    Wazo: ${step.thought}`);
          console.log(`    Kiwango cha Uhakika: ${Math.round(step.confidence * 100)}%`);
        }
      }

      console.log('\n🎯 Hitimisho Lililothibitishwa:');
      console.log(task.result);
      break;
    }

    case 'learn': {
      console.log('📚 INAENDESHA MZUNGUKO WA MAFUNZO NA TATHMINI...');

      // 1. Record a detected gap
      console.log('\n1. Kutambua Pengo la Maarifa (Knowledge Gap)...');
      const gap = system.learning.recordKnowledgeGap(
        'Usanifu wa Hexagonal katika Mifumo ya AI',
        'AI ilihitaji ufafanuzi wa namna ya kutenganisha Ports na Adapters.',
        'high'
      );
      console.log(`  Pengo lililorekodiwa: [${gap.id}] "${gap.topic}"`);

      // 2. Ingest structured lesson
      console.log('\n2. Kuingiza Somo Lililothibitishwa (Lesson Ingestion)...');
      const lessonResult = await system.learning.ingestLesson({
        id: 'LESSON-HEX-001',
        topic: 'Usanifu wa Hexagonal katika Mifumo ya AI',
        summary: 'Hexagonal Architecture inatenganisha Core Domain na mifumo ya nje kupitia Interfaces.',
        content: 'Katika AI, reasoning na identity hazitegemei direct LLM API wala direct database. Zote zinaingia kupitia Ports.',
        verificationQuestion: 'Ni nini faida ya Ports na Adapters?',
        expectedAnswer: 'Kuruhusu kubadilisha database au LLM bila kubadilisha logic ya msingi.',
      });
      console.log(`  Somo limehifadhiwa kwenye Memory ID: ${lessonResult.memoryId}`);
      console.log(`  Mapungufu yaliyotatuliwa: ${lessonResult.resolvedGaps}`);

      // 3. Run Benchmark Evaluation
      console.log('\n3. Kuendesha Mtihani wa Kiotomatiki (Evaluation Benchmark)...');
      const bench = await system.learning.evaluateBenchmark('BENCH-001-SAFETY');
      console.log(`  Mtihani: ${bench.benchmarkId}`);
      console.log(`  Alama: ${bench.score}% (Imefaulu: ${bench.passed ? 'NDIYO' : 'HAPANA'})`);
      for (const obs of bench.observations) {
        console.log(`    - ${obs}`);
      }
      break;
    }

    case 'rollback': {
      console.log('🛡️ INAJARIBU MFUMO WA SNAPSHOT NA ROLLBACK...');

      // 1. Create initial snapshot
      console.log('1. Kutengeneza Snapshot ya awali...');
      const snap1 = await system.rollback.createSnapshot('Toleo la Kwanza Salama');
      console.log(`  Snapshot imeundwa: ${snap1.id} (Toleo: ${snap1.version})`);

      // 2. Simulate experimental change
      console.log('\n2. Kufanya mabadiliko ya majaribio kwenye Identity...');
      system.identity.updateVersion('1.1.0-beta', 'Majaribio ya sera mpya');
      console.log(`  Toleo jipya sasa: ${system.identity.getIdentity().version}`);

      // 3. Rollback to snapshot
      console.log('\n3. Kurejesha toleo salama (Rollback Execution)...');
      const restored = await system.rollback.rollbackToSnapshot(snap1.id);
      console.log(`  Rollback imefaulu: ${restored ? 'NDIYO' : 'HAPANA'}`);
      console.log(`  Toleo baada ya rollback: ${system.identity.getIdentity().version}`);
      break;
    }

    default:
      console.log(`Amri isiyojulikana: "${command}". Amri zinazopatikana: status, task, learn, rollback`);
  }

  console.log('\n====================================================');
}

main().catch((err) => {
  console.error('Hitilafu:', err);
  process.exit(1);
});
