export const firstNames = [
  'Ana',
  'Bruno',
  'Camila',
  'Diego',
  'Eduarda',
  'Felipe',
  'Gabriela',
  'Heitor',
  'Isabela',
  'João',
  'Larissa',
  'Mateus',
  'Natália',
  'Otávio',
  'Patrícia',
  'Rafael',
  'Sofia',
  'Thiago',
  'Vitória',
  'Yuri',
] as const;

export const lastNames = [
  'Almeida',
  'Barbosa',
  'Cardoso',
  'Conceição',
  'Costa',
  'Ferreira',
  'Gomes',
  'Lima',
  'Martins',
  'Nascimento',
  'Oliveira',
  'Pereira',
  'Ribeiro',
  'Rocha',
  'Santos',
  'Souza',
] as const;

export const cities = [
  'São Paulo',
  'Rio de Janeiro',
  'Belo Horizonte',
  'Salvador',
  'Recife',
  'Fortaleza',
  'Curitiba',
  'Porto Alegre',
  'Manaus',
  'Goiânia',
] as const;

/** `count` distinct full names. */
export function fullNames(pick: <T>(items: readonly T[]) => T, count: number): string[] {
  const names = new Set<string>();
  while (names.size < count) names.add(`${pick(firstNames)} ${pick(lastNames)}`);
  return [...names];
}

/** `João Conceição` → `joao.conceicao` */
export function emailLocalPart(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll(' ', '.');
}

/** ISO date `days` after `start`. */
export function addDays(start: string, days: number): string {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
