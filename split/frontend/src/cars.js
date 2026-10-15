// Car families the simulator knows (autopulse/generator.py CAR_TYPES), with friendly names.
export const CAR_INFO = {
  hatchback: { name: 'Hatchback', spec: '1.2 L petrol · city car' },
  sedan: { name: 'Sedan', spec: '1.5 L petrol · family saloon' },
  suv: { name: 'SUV', spec: '2.0 L · seven-seater' },
  pickup: { name: 'Pickup', spec: '2.4 L · utility' },
  coupe: { name: 'Sports coupe', spec: '2.0 L turbo · two-door' },
};

export const carName = (type) => CAR_INFO[type]?.name || type;
