// Starter exercise library. Every entry is editable/archivable in the app.
// type: weight | bodyweight | hold | stretch | interval | steady
// modality (cardio only): row | ski | bike | run | other
export const MUSCLES = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms',
  'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Hips', 'Full body', 'Cardio'
];

export const CATEGORIES = ['Strength', 'Calisthenics', 'Stretch', 'Cardio'];

const S = (name, muscles, perSide = false) => ({ name, type: 'weight', category: 'Strength', muscles, perSide });
const C = (name, muscles, perSide = false) => ({ name, type: 'bodyweight', category: 'Calisthenics', muscles, perSide });
const H = (name, muscles, perSide = false) => ({ name, type: 'hold', category: 'Calisthenics', muscles, perSide });
const ST = (name, muscles, perSide = false) => ({ name, type: 'stretch', category: 'Stretch', muscles, perSide });
const I = (name, modality) => ({ name, type: 'interval', category: 'Cardio', muscles: ['Cardio'], modality });
const Z = (name, modality) => ({ name, type: 'steady', category: 'Cardio', muscles: ['Cardio'], modality });

export const SEED_EXERCISES = [
  // Strength
  S('Back Squat', ['Quads', 'Glutes']),
  S('Front Squat', ['Quads', 'Core']),
  S('Goblet Squat', ['Quads', 'Glutes']),
  S('Deadlift', ['Back', 'Hamstrings', 'Glutes']),
  S('Romanian Deadlift', ['Hamstrings', 'Glutes']),
  S('Bulgarian Split Squat', ['Quads', 'Glutes'], true),
  S('Walking Lunge', ['Quads', 'Glutes'], true),
  S('Hip Thrust', ['Glutes']),
  S('Leg Press', ['Quads']),
  S('Leg Curl', ['Hamstrings']),
  S('Leg Extension', ['Quads']),
  S('Calf Raise', ['Calves']),
  S('Bench Press', ['Chest', 'Triceps']),
  S('Incline Dumbbell Press', ['Chest', 'Shoulders']),
  S('Cable Fly', ['Chest']),
  S('Overhead Press', ['Shoulders', 'Triceps']),
  S('Dumbbell Shoulder Press', ['Shoulders']),
  S('Lateral Raise', ['Shoulders']),
  S('Face Pull', ['Shoulders', 'Back']),
  S('Barbell Row', ['Back']),
  S('Single-arm Dumbbell Row', ['Back'], true),
  S('Lat Pulldown', ['Back', 'Biceps']),
  S('Seated Cable Row', ['Back']),
  S('Bicep Curl', ['Biceps']),
  S('Hammer Curl', ['Biceps', 'Forearms']),
  S('Tricep Pushdown', ['Triceps']),
  S('Overhead Tricep Extension', ['Triceps']),

  // Calisthenics — reps (optional added / assisted kg)
  C('Pull-up', ['Back', 'Biceps']),
  C('Chin-up', ['Back', 'Biceps']),
  C('Muscle-up', ['Back', 'Chest', 'Triceps']),
  C('Dip', ['Chest', 'Triceps']),
  C('Push-up', ['Chest', 'Triceps']),
  C('Diamond Push-up', ['Triceps', 'Chest']),
  C('Archer Push-up', ['Chest'], true),
  C('Pike Push-up', ['Shoulders', 'Triceps']),
  C('Handstand Push-up', ['Shoulders', 'Triceps']),
  C('Inverted Row', ['Back']),
  C('Bodyweight Squat', ['Quads', 'Glutes']),
  C('Pistol Squat', ['Quads', 'Glutes'], true),
  C('Shrimp Squat', ['Quads', 'Glutes'], true),
  C('Nordic Curl', ['Hamstrings']),
  C('Hanging Leg Raise', ['Core']),
  C('Toes-to-Bar', ['Core']),
  C('Dragon Flag', ['Core']),

  // Calisthenics — timed holds
  H('L-sit', ['Core']),
  H('Plank', ['Core']),
  H('Side Plank', ['Core'], true),
  H('Hollow Body Hold', ['Core']),
  H('Dead Hang', ['Forearms', 'Back']),
  H('Wall Handstand', ['Shoulders']),
  H('Tuck Front Lever', ['Back', 'Core']),
  H('Tuck Planche', ['Shoulders', 'Core']),

  // Stretch
  ST('Couch Stretch', ['Quads', 'Hips'], true),
  ST('Pigeon Stretch', ['Glutes', 'Hips'], true),
  ST('90/90 Hip Stretch', ['Hips'], true),
  ST('Standing Hamstring Stretch', ['Hamstrings'], true),
  ST('Seated Forward Fold', ['Hamstrings']),
  ST('Butterfly Stretch', ['Hips']),
  ST('Deep Squat Hold', ['Hips', 'Calves']),
  ST('Calf Stretch', ['Calves'], true),
  ST('Doorway Pec Stretch', ['Chest', 'Shoulders']),
  ST('Cross-body Shoulder Stretch', ['Shoulders'], true),
  ST('Thread the Needle', ['Back', 'Shoulders'], true),
  ST("Child's Pose", ['Back']),
  ST('Cobra', ['Core', 'Back']),

  // Cardio
  I('Row Intervals', 'row'),
  I('SkiErg Intervals', 'ski'),
  I('Bike Intervals', 'bike'),
  I('Run Intervals', 'run'),
  Z('Zone 2 Row', 'row'),
  Z('Zone 2 Bike', 'bike'),
  Z('Zone 2 Run', 'run'),
];
