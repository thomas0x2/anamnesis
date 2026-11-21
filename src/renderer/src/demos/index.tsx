// Demo registry: the tutor names a demo by id and passes its parameters as a JSON string.
import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { AliasingDemo, FourierSeriesDemo, RootsOfUnityDemo, TrigInterpDemo } from './fourier'
import { CancellationDemo, CobwebDemo, NewtonDemo, QuadratureDemo } from './analysis'
import { ChebyshevDemo, InterpolationDemo, LebesgueDemo, SplinesDemo } from './interp'
import { parseParams, type Params } from './kit'
import { LeastSquaresDemo, SvdDemo } from './linalg'

type DemoComponent = (props: { p: Params; caption?: string | null }) => ReactElement

export const DEMOS: Record<string, { title: string; component: DemoComponent; example: Params }> = {
  interpolation: { title: 'Polynomial interpolation', component: InterpolationDemo, example: { f: '1/(1+25*x^2)', n: 10, nodes: 'equispaced', showError: true } },
  lebesgue: { title: 'Lebesgue function', component: LebesgueDemo, example: { n: 10 } },
  chebyshev: { title: 'Chebyshev polynomials', component: ChebyshevDemo, example: { n: 5 } },
  cancellation: { title: 'Cancellation', component: CancellationDemo, example: { f: 'exp(x)', x0: 1 } },
  'fourier-series': { title: 'Fourier series', component: FourierSeriesDemo, example: { f: 'square', m: 10 } },
  'roots-of-unity': { title: 'Roots of unity', component: RootsOfUnityDemo, example: { N: 8, k: 1 } },
  'trig-interp': { title: 'Trigonometric interpolation', component: TrigInterpDemo, example: { f: 'exp(sin(2*pi*x))', n: 8, N: 64 } },
  aliasing: { title: 'Aliasing', component: AliasingDemo, example: { k: 7, n: 8 } },
  splines: { title: 'Splines', component: SplinesDemo, example: { f: '1/(1+25*x^2)', n: 9 } },
  quadrature: { title: 'Quadrature', component: QuadratureDemo, example: { f: 'exp(x)', a: 0, b: 1, rule: 'trapezoidal', N: 4 } },
  cobweb: { title: 'Fixed-point iteration', component: CobwebDemo, example: { phi: 'cos(x)', x0: 1, steps: 10, xMin: 0, xMax: 1.6 } },
  newton: { title: "Newton's method", component: NewtonDemo, example: { f: 'x^2-2', x0: 2, steps: 6, xMin: 0, xMax: 3 } },
  svd: { title: 'SVD', component: SvdDemo, example: { A: [[2, 1], [1, 3]] } },
  'least-squares': { title: 'Least squares', component: LeastSquaresDemo, example: { f: 'sin(2*x)', degree: 2, n: 20, noise: 0.2 } }
}

class DemoBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown): { error: string } {
    return { error: String((e as Error)?.message ?? e) }
  }
  componentDidCatch(e: unknown, info: ErrorInfo): void {
    console.warn('demo failed', e, info.componentStack)
  }
  render(): ReactNode {
    return this.state.error ? <div className="tex-error">This demo could not run: {this.state.error}</div> : this.props.children
  }
}

export function DemoView({ id, params, caption }: { id: string; params: string | Params | null; caption?: string | null }): ReactElement {
  const entry = DEMOS[id]
  if (!entry) return <div className="tex-error">Unknown demo “{id}”.</div>
  const p = typeof params === 'string' || params === null ? parseParams(params) : params
  const C = entry.component
  return (
    <DemoBoundary>
      <C p={p} caption={caption} />
    </DemoBoundary>
  )
}
