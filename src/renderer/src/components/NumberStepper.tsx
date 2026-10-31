import {useRef, type InputHTMLAttributes} from 'react';
import {t} from '@shared/i18n';
import {ControlIcon} from './ControlIcon';

type NumberStepperProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: string | number;
  onValueChange: (value: string) => void;
  compact?: boolean;
};

/** Keep native numeric validation and keyboard stepping, with accessible SVG buttons. */
export function NumberStepper({value, onValueChange, className = '', compact = false, disabled, readOnly, min, max, step = 1, ...props}: NumberStepperProps) {
  const input = useRef<HTMLInputElement>(null);
  const numeric = value === '' ? NaN : Number(value);
  const change = (direction: number) => {
    const element = input.current;
    if (!element || disabled || readOnly) return;
    // Native stepping respects min/max, decimal steps and off-step typed values.
    element.stepUp(direction);
    onValueChange(element.value);
  };
  return <span className={`number-stepper ${compact ? 'is-compact ' : ''}${className}`.trim()} data-disabled={disabled || readOnly || undefined}>
    <input {...props} ref={input} className="number-stepper-input" type="number" value={value} min={min} max={max} step={step} disabled={disabled} readOnly={readOnly} onChange={event => onValueChange(event.target.value)}/>
    <button type="button" className="number-stepper-button is-decrease" aria-label={t('减少数值')} title={t('减少数值')} disabled={disabled || readOnly || (Number.isFinite(numeric) && min !== undefined && numeric <= Number(min))} onMouseDown={event => event.preventDefault()} onClick={event => {event.preventDefault();event.stopPropagation();change(-1);}}><ControlIcon name="minus"/></button>
    <button type="button" className="number-stepper-button is-increase" aria-label={t('增加数值')} title={t('增加数值')} disabled={disabled || readOnly || (Number.isFinite(numeric) && max !== undefined && numeric >= Number(max))} onMouseDown={event => event.preventDefault()} onClick={event => {event.preventDefault();event.stopPropagation();change(1);}}><ControlIcon name="plus"/></button>
  </span>;
}
