import { ALL_MINIGAMES } from '../src/minigames/all';
import { MINIGAMES } from '../src/minigames/registry';
import { kokosRegen } from '../src/minigames/games/kokosRegen';
for (const f of ['2v2', '1v3'] as const) {
  const stub = { ...kokosRegen, id: `stub${f}`, format: f };
  ALL_MINIGAMES.push(stub); MINIGAMES[stub.id] = stub;
}
const g = { ...kokosRegen, id: 'gipfelsturm', final: true };
ALL_MINIGAMES.push(g); MINIGAMES[g.id] = g;
const { simulateGame } = await import('./simulate');
for (const m of ['kokosnuss', 'vulkan', 'bimmelbahn']) {
  const r = simulateGame(m, 42, 20);
  const c = (t: string) => r.events.filter((e) => e.type === t).length;
  console.log(m, 'stars', r.state.players.map(p => p.stars), 'coins', r.state.players.map(p => p.coins), 'bought', r.state.players.map(p => p.stats.starsBought), 'mg', r.minigames.length, 'tide', c('tide'), 'erupt', c('eruption'), 'train', c('train'), 'duels', r.minigames.filter(x=>x==='schnellzieher').length, 'items', r.state.players.map(p=>p.stats.itemsUsed), 'ranking', r.state.ranking, 'bonus', JSON.stringify(r.state.bonus));
}
const mr = simulateGame('kokosnuss', 5, 20, 'marathon');
console.log('marathon', mr.minigames, mr.state.players.map(p => p.points));
