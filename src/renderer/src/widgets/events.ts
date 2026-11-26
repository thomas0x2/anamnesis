/** Fired on window when a widget reports an error, so the tutor hears about it with the card's result. */
export const WIDGET_ERROR_EVENT = 'anamnesis:widget-error'
export interface WidgetErrorDetail {
  title: string | null
  message: string
}
