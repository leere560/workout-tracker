import openpyxl
import json
import re

wb = openpyxl.load_workbook('routine.xlsx', data_only=False)
routine_data = []

def clean_text(s):
    if s is None:
        return ''
    s = str(s).strip()
    # Replace the replacement char with proper punctuation
    # 4560 -> 45°-60°, 45 -> 45°, 30 -> 30°
    s = s.replace('45\ufffd60\ufffd', '45°–60°')
    s = s.replace('45\ufffd', '45°')
    s = s.replace('30\ufffd', '30°')
    s = s.replace('\ufffd', '–')
    return s.strip()

for sname in wb.sheetnames:
    ws = wb[sname]
    # create a clean id
    day_id = re.sub(r'[^a-zA-Z0-9]', '_', sname.lower()).strip('_')
    
    # Determine target focus and icon
    day_tag = 'Upper' if 'Upper' in sname else 'Lower'
    
    day_obj = {
        'id': day_id,
        'title': sname,
        'tag': day_tag,
        'exercises': []
    }
    
    for r in range(2, ws.max_row + 1):
        name = ws.cell(r, 1).value
        if not name:
            continue
        sets_val = ws.cell(r, 2).value
        try:
            sets = int(float(sets_val))
        except (ValueError, TypeError):
            sets = 3
            
        reps = clean_text(ws.cell(r, 3).value)
        weight = clean_text(ws.cell(r, 4).value)
        if weight == '140.0':
            weight = '140 lbs'
            
        rest = clean_text(ws.cell(r, 5).value)
        notes = clean_text(ws.cell(r, 6).value)
        
        # Hyperlink formula in column 7
        video_cell = ws.cell(r, 7).value
        video_url = ''
        if video_cell and 'HYPERLINK' in str(video_cell):
            m = re.search(r'HYPERLINK\("([^"]+)"', str(video_cell))
            if m:
                video_url = m.group(1)
        
        # Clean up exercise name
        clean_name = clean_text(name)
        lower_name = clean_name.lower()
        
        # Determine if it's an exclusively optional finisher
        is_optional = False
        if 'crunch' in lower_name or 'knee raise' in lower_name:
            is_optional = True
        elif 'sat' in day_id and 'pec deck' in lower_name:
            is_optional = True
        elif 'mon' in day_id and 'adduction' in lower_name:
            is_optional = True
            
        # Target muscle category
        muscle = 'Full Body'
        if any(w in lower_name for w in ['lateral raise', 'shoulder press', 'overhead shoulder']):
            muscle = 'Shoulders'
        elif any(w in lower_name for w in ['chest press', 'pec deck', 'incline press']):
            muscle = 'Chest'
        elif any(w in lower_name for w in ['pulldown', 'row', 'lat pulldown']):
            muscle = 'Back / Lats'
        elif any(w in lower_name for w in ['hack squat', 'leg extension']):
            muscle = 'Quads'
        elif any(w in lower_name for w in ['leg press']):
            muscle = 'Quads'
        elif any(w in lower_name for w in ['leg curl', 'rdl', 'deadlift']):
            muscle = 'Hamstrings / Glutes'
        elif any(w in lower_name for w in ['calf']):
            muscle = 'Calves'
        elif any(w in lower_name for w in ['adduction', 'abduction']):
            muscle = 'Adductors / Hips'
        elif any(w in lower_name for w in ['crunch', 'knee raise', 'core']):
            muscle = 'Abs / Core'
        elif any(w in lower_name for w in ['tricep', 'pushdown', 'overhead cable']):
            muscle = 'Triceps'
        elif any(w in lower_name for w in ['bicep', 'bayonet']):
            muscle = 'Biceps'
        elif 'curl' in lower_name and 'leg' not in lower_name:
            muscle = 'Biceps'
            
        # Superset pairings logic
        superset = None
        if 'wed' in day_id:
            if 'triceps rope' in lower_name:
                superset = {
                    'id': 'upper_a_arms',
                    'tag': '5A',
                    'name': 'Arm Finisher Superset (Triceps + Biceps)',
                    'tip': '⚡ Superset: Perform 1 set of Triceps, rest 45–60s, then perform 1 set of Biceps, rest 60s. Saves ~6 mins!',
                    'rest': '45–60 sec'
                }
            elif 'cable biceps' in lower_name:
                superset = {
                    'id': 'upper_a_arms',
                    'tag': '5B',
                    'name': 'Arm Finisher Superset (Triceps + Biceps)',
                    'tip': '⚡ Superset: Alternate with Triceps Rope Pushdown. Saves ~6 mins!',
                    'rest': '60 sec'
                }
        elif 'fri' in day_id:
            if 'leg extension' in lower_name:
                superset = {
                    'id': 'lower_a_quad_ham',
                    'tag': '2A',
                    'name': 'Antagonist Superset (Quads + Hamstrings)',
                    'tip': '⚡ Superset: Perform 1 set of Leg Extensions, rest 60s, then perform 1 set of Seated Leg Curls, rest 60s. Saves ~8 mins!',
                    'rest': '60 sec'
                }
            elif 'seated leg curl' in lower_name:
                superset = {
                    'id': 'lower_a_quad_ham',
                    'tag': '2B',
                    'name': 'Antagonist Superset (Quads + Hamstrings)',
                    'tip': '⚡ Superset: Alternate with Leg Extensions. Quads rest while hamstrings work!',
                    'rest': '60–75 sec'
                }
        elif 'sat' in day_id:
            if 'overhead cable triceps' in lower_name:
                superset = {
                    'id': 'upper_b_arms',
                    'tag': '5A',
                    'name': 'Cable Arm Superset (Long-head Triceps + Lengthened Biceps)',
                    'tip': '⚡ Superset: Same cable station! Do Overhead Extension, rest 45s, do Bayonet Curl, rest 60s. Saves ~6 mins!',
                    'rest': '45–60 sec'
                }
            elif 'bayonet cable curl' in lower_name:
                superset = {
                    'id': 'upper_b_arms',
                    'tag': '5B',
                    'name': 'Cable Arm Superset (Long-head Triceps + Lengthened Biceps)',
                    'tip': '⚡ Superset: Alternate with Overhead Triceps Extensions. Saves ~6 mins!',
                    'rest': '60 sec'
                }
        elif 'mon' in day_id:
            if 'machine hip adduction' in lower_name:
                superset = {
                    'id': 'lower_b_acc',
                    'tag': '4A',
                    'name': 'Accessory Superset (Adductors + Calves)',
                    'tip': '⚡ Superset: Perform 1 set of Adduction, rest 45s, perform Calf Press, rest 60s. Saves ~6 mins!',
                    'rest': '45–60 sec'
                }
            elif 'leg press calf press' in lower_name:
                superset = {
                    'id': 'lower_b_acc',
                    'tag': '4B',
                    'name': 'Accessory Superset (Adductors + Calves)',
                    'tip': '⚡ Superset: Alternate with Hip Adduction. Saves ~6 mins!',
                    'rest': '60 sec'
                }

        day_obj['exercises'].append({
            'id': f'{day_id}_ex{r-1}',
            'name': clean_name,
            'muscle': muscle,
            'sets': sets,
            'targetReps': reps,
            'startingWeight': weight,
            'rest': rest,
            'notes': notes,
            'videoUrl': video_url,
            'isOptional': is_optional,
            'superset': superset
        })

    # Add dedicated optional finisher for Wed Upper A
    if 'wed' in day_id:
        day_obj['exercises'].append({
            'id': f'{day_id}_opt_facepull',
            'name': 'Cable Face Pull (Rear Delts & Posture)',
            'muscle': 'Shoulders',
            'sets': 2,
            'targetReps': '12–15',
            'startingWeight': '30–40 lbs',
            'rest': '60 sec',
            'notes': 'Set pulley to eye level; thumbs back; pull rope toward forehead while pulling elbows back to build healthy shoulders.',
            'videoUrl': 'https://www.youtube.com/results?search_query=Jeff+Nippard+face+pull+technique',
            'isOptional': True,
            'superset': None
        })

    routine_data.append(day_obj)

with open('routine-data.js', 'w', encoding='utf-8') as f:
    f.write('// Pre-loaded routine parsed from 4-Day_Machine_lifting_routine.xlsx\n')
    f.write('const DEFAULT_ROUTINE = ')
    f.write(json.dumps(routine_data, indent=2, ensure_ascii=False))
    f.write(';\n\nif (typeof module !== "undefined") { module.exports = { DEFAULT_ROUTINE }; }\n')

print(f"Generated routine-data.js with {len(routine_data)} workout days.")
for d in routine_data:
    print(f" - {d['title']}: {len(d['exercises'])} exercises (Optional: {[e['name'] for e in d['exercises'] if e['isOptional']]})")
