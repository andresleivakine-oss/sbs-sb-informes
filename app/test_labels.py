"""Etiquetas de interfaz. No transforma resultados ni umbrales clínicos."""
import re
EXACT={
'imtp_title':'IMTP · tirón isométrico de medio muslo',
'exercise_template_builtin_leg_hamstrings_90_text':'Isquiotibiales · 90°',
'exercise_template_builtin_body_weight_calculation':'Peso corporal',
'data_sport_squat_dynamic_report_title':'Sentadilla · informe dinámico',
'exercise_template_builtin_grip_text':'Fuerza de agarre',
'exercise_template_builtin_head_neck_flexion_text':'Flexión de cuello',
'exercise_template_builtin_leg_standing_evaluation_text':'Evaluación de pie · revisar protocolo',
'exercise_template_builtin_sens_shoulder_title':'Movilidad de hombro',
'exercise_template_builtin_arm_shoulder_external_rotation_text':'Rotación externa de hombro',
'exercise_template_builtin_arm_shoulder_external_rotation_endurance_text':'Rotación externa de hombro · resistencia',
'exercise_template_builtin_sitting_hand_grip_meter_endurance_text':'Agarre sentado · resistencia',
}
WORDS={'arm':'brazo','leg':'pierna','head':'cabeza','neck':'cuello','shoulder':'hombro','knee':'rodilla','hip':'cadera','ankle':'tobillo','foot':'pie','hand':'mano','wrist':'muñeca','grip':'agarre','external':'externa','internal':'interna','rotation':'rotación','flexion':'flexión','extension':'extensión','abduction':'abducción','adduction':'aducción','sitting':'sentado','standing':'de pie','endurance':'resistencia','evaluation':'evaluación','hamstrings':'isquiotibiales','quadriceps':'cuádriceps','jump':'salto','balance':'equilibrio','cmj':'CMJ','sj':'SJ','dj':'DJ'}
LABELS = {
    'knee': 'Rodilla', 'ankle': 'Tobillo', 'hip': 'Cadera',
    'shoulder': 'Hombro', 'trunk': 'Tronco', 'neck': 'Cuello',
    'elbow': 'Codo', 'wrist': 'Muñeca', 'hand': 'Mano', 'foot': 'Pie',
    'flexion': 'Flexión', 'extension': 'Extensión', 'rotation': 'Rotación',
    'lateral flexion': 'Flexión lateral', 'external rotation': 'Rotación externa',
    'internal rotation': 'Rotación interna', 'abduction': 'Abducción',
    'adduction': 'Aducción', 'plantar flexion': 'Flexión plantar',
    'dorsiflexion': 'Dorsiflexión', 'eversion': 'Eversión', 'inversion': 'Inversión',
    'seated': 'Sentado', 'standing': 'De pie', 'supine': 'En decúbito supino',
    'prone': 'En decúbito prono', 'side lying': 'En decúbito lateral',
    'cmj': 'Salto con contramovimiento (CMJ)', 'sj': 'Salto desde sentadilla (SJ)',
    'dj': 'Salto con caída (DJ)', 'imtp': 'Tirón isométrico de medio muslo (IMTP)',
    'jump height': 'Altura de salto', 'peak force': 'Fuerza máxima',
    'mean force': 'Fuerza media', 'peak power': 'Potencia máxima',
    'mean power': 'Potencia media', 'contact time': 'Tiempo de contacto',
    'flight time': 'Tiempo de vuelo', 'peak landing force': 'Fuerza máxima de aterrizaje',
    'reactive strength index': 'Índice de fuerza reactiva (RSI)',
    'modified reactive strength index': 'Índice de fuerza reactiva modificado (mRSI)',
    'rate of force development': 'Tasa de desarrollo de fuerza',
    'strength': 'Fuerza', 'range of motion': 'Rango de movimiento',
    'meter': 'Dinamometría', 'meter endurance': 'Resistencia muscular',
}

def spanish_label(value):
    """Traduce etiquetas conocidas y conserva las personalizadas."""
    original = str(value or '').strip()
    if not original:
        return ''
    if ' · ' in original:
        return ' · '.join(spanish_label(part) for part in original.split(' · ') if part.strip())
    position = re.fullmatch(r'Seated(\d+)DegreeKneeFlexion', original, re.IGNORECASE)
    if position:
        return f'Sentado, rodilla a {position[1]}° de flexión'
    words = re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', original).replace('_', ' ').lower()
    if words in LABELS:
        return LABELS[words]
    for suffix, side in [(' left', 'izquierda'), (' right', 'derecha')]:
        if words.endswith(suffix) and words[:-len(suffix)] in LABELS:
            return LABELS[words[:-len(suffix)]] + ' ' + side
    return original

def friendly(title):
 title=str(title or '').strip()
 if title in EXACT:return EXACT[title]
 if not ('_' in title and (title.startswith(('exercise_template_','data_sport_')) or title.endswith(('_text','_title')))):return spanish_label(title) or 'Evaluación'
 raw=re.sub(r'^(exercise_template_builtin_|exercise_template_|data_sport_)','',title)
 tokens=[t for t in raw.split('_') if t not in ['text','title','builtin']]
 return ' '.join(WORDS.get(t,t) for t in tokens).strip().capitalize() or 'Evaluación Kinvent'

def classify(title,metadata=None):
 m=metadata or {};activities=m.get('activities') or [];cfg=[a.get('config') or {} for a in activities]
 types={str(x.get('activityType','')) for x in cfg};text=(str(title)+' '+str(m.get('bodyRegion',''))+' '+str(m.get('movement',''))+' '+str(m.get('testCategory',''))+' '+' '.join(str(x.get('exerciseType','')) for x in cfg)).lower()
 region=''
 for key,tokens in [('ankle',['ankle','tobillo','foot','pie']),('knee',['knee','rodilla','hamstrings','isquiotibiales','quadriceps','cuádriceps']),('hip',['hip','cadera']),('shoulder',['shoulder','hombro']),('hand',['hand','wrist','grip','mano','muñeca','agarre']),('neck',['neck','cuello']),('trunk',['trunk','back','spine','tronco'])]:
  if any(t in re.split(r'[^\wáéíóúñ]+|_',text) for t in tokens):region=key;break
 kind='other'
 if any(t in text for t in ['endurance','resistencia']):kind='endurance'
 elif any(t in text for t in ['rangeofmotion','rom ','sens_','movilidad','range_of_motion']):kind='rom'
 elif any(t in text for t in ['jump','cmj','squatjump','dropjump','salto']):kind='jump'
 elif any(t in text for t in ['balance','stance','equilibrio']):kind='balance'
 elif any(t in text for t in ['strength','meter','force','fuerza','imtp','grip','hamstrings','rotation','flexion','extension','abduction','adduction']):kind='force'
 return {'region':region,'kind':kind,'activityType':'exercise' if types=={'EXERCISE'} else 'evaluation' if types=={'EVALUATION'} else 'unknown'}

def decorate(t,metadata):
 title=t['title'];t['originalTitle']=title;t['title']=friendly(title);t.update(classify(title,metadata));return t
