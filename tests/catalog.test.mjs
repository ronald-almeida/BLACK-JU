import test from 'node:test';
import { runChecks } from '../scripts/check-catalog.mjs';
test('Todas as 20 ofertas respeitam os preços, têm capa e checkout local, sem CTAs removidos',runChecks);
