# Nodal · simulador de circuitos y campos

Simulador web educativo de circuitos eléctricos y electromagnetismo, en español, pensado para
estudiantes de ingeniería (Física II, Electrotecnia, Electrónica). Corre entero en el navegador.

**Demo:** https://stikyu.github.io/simulador-circuitos/

## Estado por etapas

- [x] **Etapa 1 – Editor:** grilla con snap, componentes, cables, mover/rotar/borrar, valores con prefijos, undo/redo, JSON y autoguardado.
- [x] **Etapa 2 – DC resistivo:** MNA, tensiones de nodo, corrientes animadas, potencias, medidores, Thevenin y paso a paso.
- [x] **Etapa 3 – Transitorios:** capacitores, bobinas, interruptores, V(t) e I(t) con τ marcada, RC/RL/RLC con su ecuación diferencial.
- [ ] **Etapa 4 – Alterna:** fasores, potencias, Bode, resonancia y filtros.
- [ ] **Etapa 5 – Campos:** electrostática, magnetostática e inducción.
- [ ] **Etapa 6 – Pulido:** ejemplos, compartir por link, temas, accesibilidad.

## Cómo correrlo

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # tests (Vitest)
npm run lint     # ESLint
npm run build    # compilación de producción en dist/
```

## Licencia

MIT
