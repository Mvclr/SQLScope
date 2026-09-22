/**
 * One set of buttons for the whole product (docs/DESIGN.md › Bento), so a primary action
 * looks the same in the editor, a lab and the sign-in form.
 *
 * - primary: the one thing to do next (Executar, Começar). At most one per block.
 * - outline: an action that produces something (Analisar, Verificar resposta).
 * - secondary: everything else that changes state.
 * - ghost: low-stakes controls inside toolbars.
 */
export type ButtonVariant = 'primary' | 'outline' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background-color,color,border-color,box-shadow,transform,filter] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent shadow-sm hover:brightness-110',
  outline: 'border border-accent/45 text-accent hover:border-accent hover:bg-accent/10',
  secondary: 'border border-border bg-surface-2 text-muted hover:bg-surface-3 hover:text-text',
  ghost: 'text-muted hover:bg-surface-2 hover:text-text',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] [&_svg]:size-3.5',
  md: 'h-8 px-3 text-[13px] [&_svg]:size-4',
  lg: 'h-10 px-4 text-[14px] [&_svg]:size-4',
};

export function buttonClass(variant: ButtonVariant, size: ButtonSize = 'sm', extra = ''): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`.trim();
}
