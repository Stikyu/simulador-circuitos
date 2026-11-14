# Arquitectura y funcionamiento del motor

Este documento explica cómo está hecho Nodal por dentro: cómo se pasa de un dibujo a un sistema
de ecuaciones, cómo aporta cada componente, cómo se resuelven el transitorio y la alterna, y por
qué se tomó cada decisión. Está pensado para leerlo de corrido y poder explicarlo en voz alta.

## 1. Vista general

```
src/
  engine/      Motor de cálculo. CERO dependencias de React o del navegador.
  components/  Qué es cada componente: terminales, propiedades y cómo "estampa" en la matriz.
  explain/     Generadores de explicaciones paso a paso (texto + fórmulas con valores reales).
  fields/      Campos eléctrico y magnético: física pura + escenas en <canvas>.
  editor/      Editor SVG: grilla, cables, selección, historial, guardado, compartir.
  ui/          Paneles, gráficos, galería, tema.
  examples/    Circuitos precargados.
tests/         Vitest: el motor contra resultados analíticos.
```

El flujo de datos es de una sola dirección:

```
dibujo (Circuit) ──buildNetlist──▶ grafo eléctrico (Netlist)
        ──validateTopology──▶ ¿tiene solución?
        ──estampado MNA──▶ A·x = b ──eliminación gaussiana──▶ x
        ──▶ tensiones de nodo, corrientes, potencias ──▶ paneles, gráficos, animación
```

La regla de dependencias es estricta: `engine/` y `components/` no importan nada de React. Por
eso los tests arman circuitos a mano y prueban el motor sin interfaz, y por eso el motor se
podría reutilizar en Node, en un worker o en otra interfaz.

## 2. El modelo de datos

Un circuito es un objeto JSON plano (`src/engine/circuit.ts`):

```ts
interface Circuit {
  version: 1;
  components: { id; type; x; y; rot; props }[]; // posición en celdas de grilla
  wires: { id; a: Point; b: Point }[]; // segmentos entre puntos de grilla
}
```

Dos consecuencias importantes:

- **Es serializable tal cual.** Guardar, abrir, autoguardar en `localStorage` y compartir por
  link son todos `JSON.stringify` (el link además lo comprime con lz-string en el fragmento
  `#c=...` de la URL; no hay servidor).
- **Es inmutable.** Cada operación del editor (`src/editor/ops.ts`) devuelve un circuito nuevo.
  El undo/redo es entonces trivial: una pila de instantáneas. Un arrastre completo se agrupa en
  un solo paso con `beginGesture` / `endGesture`.

Las coordenadas son enteras (celdas), no píxeles. "¿Están conectados estos dos puntos?" se
responde comparando enteros, sin tolerancias.

## 3. Del dibujo a la netlist

`buildNetlist` (`src/engine/netlist.ts`) convierte geometría en topología con **union-find**:

1. Cada terminal y cada extremo de cable es un punto.
2. Un cable une sus dos extremos y también cualquier punto que caiga sobre él (así funcionan las
   uniones en T sin tener que partir cables).
3. Cada conjunto resultante es un **nodo** eléctrico. El conjunto que contiene una tierra es el
   nodo 0.

El resultado es una lista de elementos con los nodos de sus terminales, por ejemplo
`{ id: 'R1', type: 'resistor', nodes: [1, 2], props: { R: 1000 } }`. A partir de acá el motor
no sabe nada de píxeles ni de cables.

## 4. Análisis nodal modificado (MNA)

### La idea

El análisis nodal clásico escribe la ley de corrientes de Kirchhoff (KCL) en cada nodo, con las
tensiones de nodo como incógnitas. Funciona para todo lo que tenga una relación `i = f(v)`, como
una resistencia. Pero una fuente de tensión ideal no la tiene: su corriente la decide el resto
del circuito.

El análisis nodal **modificado** resuelve eso agregando incógnitas: por cada rama que impone
una tensión, su **corriente** pasa a ser incógnita y se suma una ecuación (la de la rama). El
sistema queda:

```
┌       ┐ ┌   ┐   ┌   ┐
│ G   B │ │ v │   │ i │     v: tensiones de nodo        i: corrientes inyectadas
│ C   D │ │ j │ = │ e │     j: corrientes de las ramas  e: tensiones impuestas
└       ┘ └   ┘   └   ┘
```

### Las dos primitivas

Todos los componentes se construyen con solo dos operaciones (`src/engine/mna.ts`):

**`stampAdmittance(el, Y, Ieq)`** — rama con `i(a→b) = Y·(va − vb) + Ieq`:

```
        col a   col b                 fila a:  −Ieq
fila a   +Y      −Y                   fila b:  +Ieq
fila b   −Y      +Y
```

**`stampVoltage(el, V, r)`** — agrega la incógnita `i` (columna y fila `k`) y la ecuación
`va − vb − r·i = V`:

```
        col a   col b   col k
fila a                   +1          (la corriente sale del nodo a)
fila b                   −1          (y entra al nodo b)
fila k   +1      −1      −r   = V
```

Las filas y columnas de tierra no se escriben: tierra no es incógnita.

### Ejemplo: divisor de tensión

`V1 = 10 V` entre N1 y tierra, `R1 = 1 kΩ` entre N1 y N2, `R2 = 2 kΩ` entre N2 y tierra.
Incógnitas: `N1`, `N2`, `I(V1)`.

```
[  1m   −1m    1 ] [ N1    ]   [  0 ]     KCL en N1
[ −1m   1,5m   0 ] [ N2    ] = [  0 ]     KCL en N2
[  1     0     0 ] [ I(V1) ]   [ 10 ]     ecuación de la fuente
```

Solución: `N1 = 10 V`, `N2 = 6,67 V`, `I(V1) = −3,33 mA`. El signo negativo no es un error:
la corriente de rama se define del terminal `a` (+) al `b` (−) **por dentro** del componente,
así que una fuente que entrega energía tiene corriente negativa. Con esa convención única para
todos, la potencia absorbida es siempre `v·i` (negativa = entrega) y la suma de potencias da
cero, lo que se verifica en un test.

### Cómo estampa cada componente

| Componente          | Continua (DC)                                              | Alterna (AC)         | Transitorio            | t = 0 (cond. iniciales)  |
| ------------------- | ---------------------------------------------------------- | -------------------- | ---------------------- | ------------------------ |
| Resistencia         | admitancia `1/R`                                           | `1/R`                | `1/R`                  | `1/R`                    |
| Fuente de tensión   | tensión `V`                                                | tensión `0` (corto)  | tensión `V`            | tensión `V`              |
| Fuente senoidal     | tensión `0`                                                | fasor `A∠φ`          | `A·sen(ωt + φ)`        | `A·sen(φ)`               |
| Fuente de corriente | `Y = 0`, `Ieq = −I`                                        | `0` (abierta)        | `Ieq = −I`             | `Ieq = −I`               |
| Capacitor           | nada (abierto)                                             | admitancia `jωC`     | `Geq` + `Ieq` (ver §6) | fuente de tensión `v0`   |
| Bobina              | tensión `0` (corto)                                        | admitancia `1/(jωL)` | `Geq` + `Ieq` (ver §6) | fuente de corriente `i0` |
| Interruptor         | tensión `0`, `r = 0` o `1 GΩ` según esté cerrado o abierto |                      |                        |
| Amperímetro         | tensión `0` (su corriente de rama es la lectura)           |                      |                        |
| Voltímetro          | admitancia `1/1 GΩ`                                        |                      |                        |

Cada definición vive en su archivo de `src/components/` y son pocas líneas. Agregar un
componente lineal nuevo es escribir su `stamp` y su símbolo; el motor no se toca.

### Resolver el sistema

`src/engine/linear.ts` implementa **eliminación gaussiana con pivoteo parcial y escalado de
filas**, en versión real y compleja. El escalado importa porque conviven coeficientes de órdenes
muy distintos (1 nS de un interruptor abierto junto a unos de las ecuaciones de rama): sin
escalar, el pivoteo elegiría mal.

Se usa matriz densa a propósito: los circuitos didácticos tienen decenas de incógnitas, así que
O(n³) es instantáneo, y un solver denso de 150 líneas se puede leer y testear entero. Con miles
de nodos habría que pasar a matrices ralas con LU.

## 5. Errores que se entienden

Un "pivote nulo" no le dice nada a un estudiante. Por eso **antes** de resolver,
`validateTopology` (`src/engine/checks.ts`) busca sobre el grafo las causas típicas de una
matriz singular y las explica:

- **Falta la tierra**: no hay referencia de potencial.
- **Nodo flotante**: se recorre el grafo desde tierra usando solo los elementos que conducen en
  ese tipo de análisis; lo que no se alcanza está flotando. (En DC un capacitor no cuenta: es un
  abierto. Por eso dos capacitores en serie dan error en DC pero no en transitorio.)
- **Lazo de fuentes de tensión**: se van uniendo con union-find los nodos de las ramas que
  imponen tensión; si una rama une dos nodos que ya estaban unidos, cierra un lazo. Con una
  búsqueda en anchura se recupera el camino completo para nombrar a todos los involucrados.
  En DC las bobinas cuentan como ramas de tensión (son cortos).
- **Fuente en cortocircuito**: los dos terminales en el mismo nodo.

Para esto cada componente declara su **papel** (`role`) según el análisis: `voltage` (impone
tensión), `path` (conduce) u `open` (no une sus nodos). Cada error lleva la lista de
componentes culpables y el editor los pinta de rojo. Si aun así el solver encuentra un pivote
nulo, se traduce a "matriz singular" señalando el nodo o la rama donde ocurrió.

## 6. Transitorio

### Modelos equivalentes (companion models)

La idea central: **discretizar la derivada convierte cada elemento con memoria en una
resistencia más una fuente**, y entonces cada paso de tiempo es un problema de continua que se
resuelve con el mismo MNA.

Capacitor, `i = C·dv/dt`, con la **regla trapezoidal** (promediar la derivada entre los dos
extremos del paso `h`):

```
v[n+1] − v[n] = (h / 2C) · (i[n+1] + i[n])
        ⟹   i[n+1] = (2C/h)·v[n+1]  −  ( (2C/h)·v[n] + i[n] )
                      └── Geq ──┘        └────── Ieq ──────┘
```

Es exactamente la forma `i = Y·v + Ieq` de `stampAdmittance`: una conductancia `Geq = 2C/h`
en paralelo con una fuente de corriente que resume el pasado. Para la bobina, `v = L·di/dt`,
queda `Geq = h/(2L)` e `Ieq = i[n] + Geq·v[n]`.

Con **Euler hacia atrás** (usar solo la derivada al final del paso): `Geq = C/h`,
`Ieq = −Geq·v[n]` para el capacitor; `Geq = h/L`, `Ieq = i[n]` para la bobina.

### Trapezoidal vs. Euler hacia atrás

|                  | Trapezoidal                                       | Euler hacia atrás         |
| ---------------- | ------------------------------------------------- | ------------------------- |
| Orden            | 2 (error ∝ h²)                                    | 1 (error ∝ h)             |
| Amortiguamiento  | Ninguno: conserva bien las oscilaciones de un RLC | Agrega pérdida artificial |
| Discontinuidades | "Rebota" (oscila paso a paso)                     | Las absorbe               |

El simulador usa trapezoidal por defecto y **hace con Euler hacia atrás el paso en que conmuta
un interruptor**. Ahí la corriente del capacitor salta, y la trapezoidal arrastraría el valor
viejo de `i[n]` generando un zigzag numérico. Hay un test que verifica que después de una
conmutación la corriente decae de forma monótona.

### Condiciones iniciales

En `t = 0` se resuelve un sistema especial: cada capacitor se reemplaza por una fuente de
tensión `v(0)` y cada bobina por una fuente de corriente `i(0)`. De ahí salen `i_C(0⁺)` y
`v_L(0⁺)`, que la trapezoidal necesita para arrancar. Los valores iniciales vienen de las
propiedades de cada componente o, si se elige, del régimen permanente DC previo.

### Interruptores

Un interruptor siempre es una rama con corriente incógnita: `va − vb = 0` cerrado,
`va − vb − 1 GΩ·i = 0` abierto. La estructura de la matriz no cambia al conmutar, y un circuito
con el interruptor abierto no queda con nodos flotantes. El paso que termina en `t` resuelve el
intervalo `(t − h, t]`, así que el estado que cuenta es el del **comienzo** del intervalo; un
test detectó que evaluarlo al final adelantaba la conmutación un paso.

### Matriz de estado y explicación analítica

Para explicar el transitorio hace falta saber qué tipo de circuito es. `stateMatrix` lo averigua
numéricamente: anula las fuentes, excita **una variable de estado por vez** (1 V en un
capacitor o 1 A en una bobina, el resto en cero) y mide qué derivada produce en cada una
(`i_C/C` o `v_L/L`). Eso da la matriz `A` de `dx/dt = A·x`:

- Con 1 elemento: `τ = −1/A₁₁` (y de ahí la resistencia de Thevenin).
- Con 2 elementos: la ecuación característica es `s² − traza(A)·s + det(A) = 0`, o sea
  `α = −traza/2` y `ω0² = det`. Comparando `α` con `ω0` sale si es sub, crítica o
  sobreamortiguada. Funciona para cualquier topología, no solo el RLC serie de los libros.

Con eso `explain/transient.ts` escribe la solución cerrada con los números del circuito. Un test
simula cada caso y exige que la fórmula explicada coincida con la curva simulada.

## 7. Alterna

En régimen senoidal permanente todas las señales tienen la misma frecuencia, y cada una se
representa con un **fasor** (número complejo: amplitud y fase). Derivar equivale a multiplicar
por `jω`, así que:

```
capacitor:  i = C·dv/dt  →  I = jωC·V      →  Y = jωC
bobina:     v = L·di/dt  →  V = jωL·I      →  Y = 1/(jωL)
```

**Se reutiliza todo el MNA**: los coeficientes de la matriz ya se guardan con parte real e
imaginaria, y solo cambia que se llama al solver complejo. Las fuentes continuas valen cero
(tensión → corto, corriente → abierta), porque se analiza solo la componente senoidal.

Convenciones: amplitud **pico** y referencia **seno** (`v(t) = A·sen(ωt + φ)` ↔ `A∠φ`). Con
amplitudes pico la potencia compleja es `S = ½·V·I* = P + jQ`.

El **Bode** es resolver ese mismo sistema para 700 frecuencias en escala logarítmica y graficar
`H = V_salida / V_fuente`. `analyzeResponse` clasifica la curva mirando los extremos y sus
pendientes (pasa bajos, pasa altos, pasa banda, elimina banda), y mide el corte a −3 dB, la
resonancia (refinada con una parábola por tres puntos) y el ancho de banda.

## 8. La corriente por los cables

MNA no calcula la corriente de un cable: todos los cables de un nodo son "el mismo punto". Pero
para animar el sentido real hace falta. `computeFlows` la reconstruye por conservación: dentro
de cada nodo los cables forman un árbol, la corriente que entra o sale por cada terminal es
conocida, y la de cada tramo es la suma de lo que inyectan los terminales que cuelgan de él. Se
recorre el árbol de las hojas a la raíz acumulando.

## 9. Explicaciones paso a paso

`explain/` no "dibuja" explicaciones a mano: las **deriva** del mismo circuito.

- **Serie / paralelo** (`seriesParallel.ts`): reduce el grafo repetidamente. Paralelo = varias
  resistencias entre el mismo par de nodos; serie = un nodo interno donde se tocan exactamente
  dos. Cada reducción arma un árbol; al final se "desanda" repartiendo tensión (serie) o
  corriente (paralelo). Si no llega a una sola resistencia (un puente de Wheatstone), devuelve
  `null`.
- **Nodal** (`dc.ts`): escribe la KCL de cada nodo con los valores reales, las ecuaciones de las
  ramas de tensión, la matriz tal como se resolvió y la solución.
- **Transitorio y alterna**: descriptos arriba.

Los tests comparan los números de la explicación con los del motor: si divergieran, la
explicación estaría mintiendo.

## 10. Campos

`fields/` separa la física (funciones puras, testeadas) del dibujo (`<canvas>`):

- **Electrostática**: superposición de Coulomb. Las líneas de campo se integran con Runge-Kutta
  4 sobre el campo normalizado; las equipotenciales salen de "marching squares" sobre una grilla
  del potencial. Las placas paralelas son dos filas de líneas de carga (núcleo 1/r), lo que deja
  ver los efectos de borde y comparar contra `E = V/d`.
- **Magnetostática**: Biot-Savart sumando tramos rectos cortos (regla del punto medio). La
  espira y el solenoide se discretizan en 3D y el campo se muestrea una vez en una grilla del
  plano; las líneas se trazan interpolando esa grilla.
- **Inducción**: imán como dipolo sobre el eje de una bobina; flujo en forma cerrada y
  `ε = −N·dΦ/dt`.

## 11. Decisiones de diseño y su porqué

| Decisión                                   | Por qué                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Motor sin React                            | Se testea solo, contra resultados analíticos. La interfaz puede cambiar sin tocarlo.           |
| Solver propio en vez de mathjs             | Son ~150 líneas legibles, con control del pivoteo y de los errores; y menos peso en el bundle. |
| Matriz densa                               | Circuitos chicos: la simplicidad vale más que la asintótica.                                   |
| Dos primitivas de estampado                | Todo componente lineal es "tipo admitancia" o "tipo tensión". Agregar uno son pocas líneas.    |
| Una sola matriz real/compleja              | DC, transitorio y AC comparten el 100 % del armado; solo cambia el solver final.               |
| Validar el grafo antes de resolver         | Permite mensajes en español con los componentes culpables, en vez de "matriz singular".        |
| Circuito inmutable                         | Undo/redo por instantáneas, y React detecta cambios por identidad.                             |
| Coordenadas enteras de grilla              | La conectividad se decide comparando enteros, sin tolerancias.                                 |
| Interruptor y voltímetro con 1 GΩ          | Evitan nodos flotantes sin alterar los resultados de forma visible.                            |
| Paso fijo en el transitorio                | Predecible y fácil de explicar; el paso se elige según τ o el período.                         |
| Netlist "estable" en la interfaz           | Mover un componente no cambia la parte eléctrica: no se vuelve a simular.                      |
| SVG para el editor, canvas para los campos | SVG da eventos y accesibilidad por elemento; canvas rinde con miles de flechas.                |
| Estado en la URL                           | Compartir sin backend ni cuentas.                                                              |

## 12. Cómo se prueba

`npm test` corre 139 tests de Vitest. Los del motor comparan contra la solución analítica con
tolerancia numérica:

- **DC**: divisor, serie/paralelo, Wheatstone equilibrado y desequilibrado, Thevenin/Norton,
  conservación de la energía, y todos los errores.
- **Transitorio**: RC y RL (curva completa y valor en `t = τ`), RLC sub/crítico/sobre contra su
  forma cerrada, conmutación sin oscilaciones numéricas, régimen senoidal.
- **AC**: módulo y fase de la impedancia, potencias, resonancia, corte de filtros a −3 dB y 45°.
- **Campos**: carga puntual, `E = −∇V`, dipolo, cable recto, espira, solenoide, Faraday.
- **Editor**: operaciones, historial, serialización, link compartido, ejemplos.

La regla que se siguió: si un test falla, se corrige el motor, no el test. Así apareció el
desfase de un paso en la conmutación de los interruptores.

## 13. Limitaciones conocidas

- Solo componentes **lineales** (sin diodos ni transistores: harían falta iteraciones de Newton).
- Paso de tiempo fijo, sin control adaptativo del error.
- Cada interruptor conmuta una sola vez.
- AC a una única frecuencia; con fuentes de frecuencias distintas se informa el error.
- La explicación analítica del transitorio llega hasta segundo orden.
- La reducción serie/paralelo explicada requiere una única fuente.
- Campos en 2D; el imán es un dipolo ideal y no se modela la autoinducción de la bobina.
