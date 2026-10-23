import { describe, expect, it } from 'vitest';
import { answerKey, checkAnswer, isFormula, prettyChem, toPlain } from '../src/lib/answers';
import { blankCard } from '../src/lib/cards';

const v = (typed: string, key: string) => checkAnswer(typed, key).verdict;

describe('checkAnswer', () => {
  it('accepts lists in any order', () => {
    expect(v('calcium, barium', 'barium, calcium')).toBe('correct');
    expect(v('calcium and barium', 'Barium, Calcium')).toBe('correct');
    expect(v('strontium, barium, calcium', 'barium; calcium; strontium')).toBe('correct');
  });

  it('says how many list items were right', () => {
    expect(checkAnswer('barium, sodium', 'barium, calcium')).toEqual({ verdict: 'wrong', note: '1 of 2 right' });
  });

  it('accepts plainly typed equations against \\ce answers, reactants in any order', () => {
    expect(v('N2 + 3H2 <=> 2NH3', '$\\ce{N2(g) + 3H2(g) <=> 2NH3(g)}$')).toBe('correct');
    expect(v('3H2 + N2 <-> 2NH3', 'N2 + 3H2 ⇌ 2NH3')).toBe('correct');
    expect(checkAnswer('N2 + 3H2 -> 2NH3', 'N2 + 3H2 <=> 2NH3')).toEqual({
      verdict: 'wrong',
      note: 'Check the arrow: it should be ⇌ (<=>)',
    });
    expect(v('N2 + H2 <=> 2NH3', 'N2 + 3H2 <=> 2NH3')).toBe('wrong');
  });

  it('accepts plain typing against LaTeX written with _ subscripts', () => {
    expect(v('CxHy + O2 -> CO2 + H2O', '$C_xH_y + O_2 \\rightarrow CO_2 + H_2O$')).toBe('correct');
    expect(v('C6H12O6', '$C_{6}H_{12}O_{6}$')).toBe('correct');
    expect(v('SO4^2-', '$SO_4^{2-}$')).toBe('correct');
    expect(v('x^2', '$x^{2}$')).toBe('correct');
  });

  it('accepts unicode subscripts and arrows', () => {
    expect(v('H₂O', 'H2O')).toBe('correct');
    expect(v('CH4 + 2O2 → CO2 + 2H2O', 'CH4 + 2O2 -> CO2 + 2H2O')).toBe('correct');
  });

  it('ignores capitals in words but not in formulas', () => {
    expect(v('le chatelier', 'Le Chatelier')).toBe('correct');
    expect(checkAnswer('co', 'CO')).toEqual({ verdict: 'close', note: 'Right, but check your capitals' });
    expect(v('nacl', 'NaCl')).toBe('close');
  });

  it('allows one slip in a long word but not in a formula', () => {
    expect(checkAnswer('equilibrum', 'equilibrium').verdict).toBe('close');
    expect(v('CO3', 'CO2')).toBe('wrong');
  });

  it('accepts any of the alternatives split by |', () => {
    expect(v('Le Chatelier', "Le Chatelier's principle | Le Chatelier")).toBe('correct');
  });

  it('treats an empty answer as empty', () => {
    expect(v('  ', 'x')).toBe('empty');
  });

  it('ignores $ signs and spaces in maths', () => {
    expect(v('cos x', '$\\cos x$'.replace('\\cos', 'cos'))).toBe('correct');
    expect(v('x^2+1', '$x^2 + 1$')).toBe('correct');
  });
});

describe('answerKey', () => {
  it('uses the answer field first, then the first line of the back', () => {
    const card = { ...blankCard('d'), back: 'Barium, calcium\n\nBoth are group 2 metals.' };
    expect(answerKey(card, 'forward')).toBe('Barium, calcium');
    expect(answerKey({ ...card, answer: 'Ba, Ca' }, 'forward')).toBe('Ba, Ca');
    expect(answerKey({ ...card, front: 'Group 2 examples?', answer: 'Ba' }, 'reverse')).toBe('Group 2 examples?');
  });
});

describe('formulas', () => {
  it('spots formulas', () => {
    for (const f of ['NaCl', 'CO2', 'H2O', 'Fe(OH)3', 'SO4^2-', 'Na+', '2NH3']) expect(isFormula(f)).toBe(true);
    for (const w of ['Barium', 'calcium', 'I', 'Hello']) expect(isFormula(w)).toBe(false);
  });

  it('shows plain chemistry nicely', () => {
    expect(prettyChem('N2 + 3H2 <=> 2NH3')).toBe('N<sub>2</sub> + 3H<sub>2</sub> ⇌ 2NH<sub>3</sub>');
    expect(prettyChem('SO4^2-')).toBe('SO<sub>4</sub><sup>2-</sup>');
    expect(prettyChem('NaCl(aq) -> Na+ + Cl-')).toBe('NaCl(aq) → Na<sup>+</sup> + Cl<sup>-</sup>');
    expect(prettyChem('barium <b>')).toBe('barium &#60;b&#62;');
  });

  it('normalises arrows', () => {
    expect(toPlain('A ⇌ B → C')).toBe('A <=> B -> C');
  });
});
