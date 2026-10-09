import pandas as pd
import json
import os
import glob
import re
import datetime
import subprocess

# Use script's directory dynamically
script_dir = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()

# 1. Dynamically load equipped subcentres and distribution dates from training list
dist_path = os.path.join(script_dir, "IOT Device Distribution.xlsx")
xl_dist = pd.ExcelFile(dist_path)

equipped_subcentres = {} # subcentre (app name) -> block
block_dates = {}         # block -> distribution date

def map_subcentre(name):
    name_clean = str(name).strip()
    if name_clean == "NON.SHC KASRAVAD":
        return "CHC Kasrawad"
    if name_clean.startswith("Ward No."):
        return "CHC Kasrawad"
    
    # Mapping Registry names to App / Distribution names
    mapping = {
        'SHC Chirali': 'SHC Sirali',
        'SHC Sirlay': 'SHC Sirali',
        'SHC Darli': 'SHC Dalki',
        'SHC Banher': 'SHC Baneehar New',
        'SHC Bhadli': 'SHC Bhadwali',
        'SHC Pokhrabad': 'SHC Pokharabad',
        'SHC Badgaon': 'SHC Badgao New',
        'SHC Tegariya': 'SHC Eagriya New',
        'SHC Sakargaon': 'SHC Shakargaon',
        'SHC Poi': 'SHC Poi New',
        'SHC Panwa New': 'SHC Panwada'
    }
    if name_clean in mapping:
        return mapping[name_clean]
    return name_clean

# Parse training sheets
for sheet in xl_dist.sheet_names:
    if "Change" in sheet:
        continue
    df_dist = pd.read_excel(dist_path, sheet_name=sheet, header=None)
    
    # A. Extract block distribution date from Title row
    title_str = str(df_dist.iloc[0, 0])
    match = re.search(r'(\d{2}-\d{2}-\d{4})', title_str)
    block_name = "Bhikangaon" if "Bhik" in sheet else sheet
    
    if match:
        d_str = match.group(1)
        block_dates[block_name] = pd.to_datetime(d_str, dayfirst=True)
    else:
        # Fallback defaults if title parsing fails
        if block_name == "Bhikangaon":
            block_dates[block_name] = pd.to_datetime("2026-05-21")
        elif block_name == "Kasrawad":
            block_dates[block_name] = pd.to_datetime("2026-06-24")
        elif block_name == "Segaon":
            block_dates[block_name] = pd.to_datetime("2026-05-18")
            
    # B. Locate and extract Place of Posting values
    header_idx = None
    for idx, row in df_dist.iterrows():
        row_str = [str(x).lower() for x in row]
        if any('place of posting' in x or 'posting' in x for x in row_str):
            header_idx = idx
            break
            
    if header_idx is not None:
        df_dist.columns = [str(x).strip() for x in df_dist.iloc[header_idx]]
        df_dist = df_dist.iloc[header_idx+1:]
        
        posting_col = [c for c in df_dist.columns if 'Place of Posting' in c or 'Place' in c or 'Posting' in c][0]
        rec_col = [c for c in df_dist.columns if 'Received' in c or 'Reviced' in c or 'Device' in c][0]
        
        # Filter for rows where the first column has digits (Sr.no)
        df_dist = df_dist[df_dist.iloc[:, 0].astype(str).str.strip().str.isdigit()]
        
        for idx, row in df_dist.iterrows():
            sub = map_subcentre(row[posting_col])
            rec = str(row[rec_col]).strip().upper()
            include = ('YES' in rec) or ("Bhik" in sheet)
            if include:
                equipped_subcentres[sub] = block_name

print("Loaded Block Distribution Dates:")
for b, d in block_dates.items():
    print(f"  {b}: {d.strftime('%Y-%m-%d')}")

print(f"\nLoaded {len(equipped_subcentres)} equipped subcentres from training list.")

# 2. Search for and load the IoT report
excel_files = glob.glob(os.path.join(script_dir, "Anmol_IOT_Report_*.xlsx"))
if not excel_files:
    all_xlsx = glob.glob(os.path.join(script_dir, "*.xlsx"))
    excel_files = [f for f in all_xlsx if "Weekly format" not in os.path.basename(f) and "IOT Device" not in os.path.basename(f) and "HRP_Line_List" not in os.path.basename(f)]

if not excel_files:
    raise FileNotFoundError("Could not find any Anmol IOT Report Excel file in " + script_dir)

# Pick the latest file by modification time
excel_files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
iot_file_path = excel_files[0]
print(f"Using IoT excel file: {iot_file_path}")

df_iot = pd.read_excel(iot_file_path, sheet_name="Report_1", skiprows=5)
df_iot = df_iot[pd.to_numeric(df_iot['Se. No.'], errors='coerce').notnull()]

# Convert Date fields
df_iot['ANC Date'] = pd.to_datetime(df_iot['ANC Date'])
df_iot['ANC Date Str'] = df_iot['ANC Date'].dt.strftime('%Y-%m-%d')

# Filter records from May 7, 2026 onwards
df_iot = df_iot[df_iot['ANC Date'] >= '2026-05-07']
print(f"Loaded {len(df_iot)} raw IoT records from 2026-05-07 onwards.")

# Helper to serialize datetimes and NaNs
def clean_val(v):
    if pd.isnull(v):
        return None
    if isinstance(v, pd.Timestamp):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, (int, float)):
        return float(v)
    return str(v)

# Convert all IoT records to dicts
records = []
excluded_iot_count = 0
for idx, row in df_iot.iterrows():
    raw_sub = str(row['Sub Facility']).strip()
    sub_facility = map_subcentre(raw_sub)
    user_name_val = str(row.get('User Name', '')).strip()

    # Segaon Block fix: Anita Chauhan is working in SHC Khamkheda,
    # but due to technical reasons entries were submitted under SHC Jamothi New.
    if 'anita' in user_name_val.lower() and 'chouhan' in user_name_val.lower() and sub_facility == 'SHC Jamothi New':
        sub_facility = 'SHC Khamkheda'

    # Talakpura fix: only count ANM contacts, do not count CHO
    if sub_facility == 'SHC Talakpura':
        role_val = str(row.get('Role Name', '')).lower()
        if 'cho' in role_val or 'vaishali' in user_name_val.lower():
            excluded_iot_count += 1
            continue
    
    # Only include if subcentre is in the active equipped list!
    if sub_facility not in equipped_subcentres:
        excluded_iot_count += 1
        continue
        
    block_name = equipped_subcentres[sub_facility]
    
    # Filter out records before the block's distribution date
    dist_date = block_dates.get(block_name)
    if dist_date and row['ANC Date'] < dist_date:
        excluded_iot_count += 1
        continue
    
    weight_iot = row['Weight by IOT']
    bp_sys_iot = row['BP_Systolic by IOT']
    bp_dia_iot = row['BP_Distolic by IOT']
    hb_iot = row['Hemoglobin by IOT']
    ogtt_iot = row['OGTT(Glucometer) by IOT']
    fhr_iot = row['FHR by IOT']
    
    has_iot = pd.notnull(weight_iot) or pd.notnull(bp_sys_iot) or pd.notnull(bp_dia_iot) or pd.notnull(hb_iot) or pd.notnull(ogtt_iot) or pd.notnull(fhr_iot)
    
    # Risk flags
    sys_val = bp_sys_iot if pd.notnull(bp_sys_iot) else row['BP_Systolic']
    dia_val = bp_dia_iot if pd.notnull(bp_dia_iot) else row['BP_Distolic']
    is_pih = False
    if pd.notnull(sys_val) and pd.notnull(dia_val):
        is_pih = float(sys_val) >= 140 or float(dia_val) >= 90
        
    w_val = weight_iot if pd.notnull(weight_iot) else row['Weight']
    is_underweight = False
    if pd.notnull(w_val):
        is_underweight = float(w_val) < 40
        
    hb_val = hb_iot if pd.notnull(hb_iot) else row['Hemoglobin']
    is_severe_anemia = False
    if pd.notnull(hb_val):
        is_severe_anemia = float(hb_val) < 7.0
        
    month_name = row['ANC Date'].strftime('%B')
    
    rec = {
        "id": int(row['Se. No.']),
        "month": month_name,
        "block": block_name,
        "facility": str(row['Facility']).strip(),
        "sub_facility": sub_facility,
        "role_name": clean_val(row['Role Name']),
        "anm_id": clean_val(row['ANM id']),
        "user_name": clean_val(row['User Name']),
        "mpid": clean_val(row['MPID']),
        "anc_no": clean_val(row['ANC No.']),
        "anc_type": clean_val(row['ANC Type']),
        "lmp_date": clean_val(row['LMP Date']),
        "reg_date": clean_val(row['Registration Date']),
        "edd_date": clean_val(row['EDD Date']),
        "anc_date": clean_val(row['ANC Date']),
        "pw_height": clean_val(row['PW Height']),
        "weight_iot": clean_val(weight_iot),
        "weight": clean_val(row['Weight']),
        "bp_sys_iot": clean_val(bp_sys_iot),
        "bp_sys": clean_val(row['BP_Systolic']),
        "bp_dia_iot": clean_val(bp_dia_iot),
        "bp_dia": clean_val(row['BP_Distolic']),
        "hb_iot": clean_val(hb_iot),
        "hb": clean_val(row['Hemoglobin']),
        "ogtt_iot": clean_val(ogtt_iot),
        "ogtt": clean_val(row['OGTT(Glucometer)']),
        "fhr_iot": clean_val(fhr_iot),
        "fhr": clean_val(row['FHR']),
        "has_iot": bool(has_iot),
        "is_pih": bool(is_pih),
        "is_underweight": bool(is_underweight),
        "is_severe_anemia": bool(is_severe_anemia)
    }
    records.append(rec)

print(f"Included {len(records)} IoT records, excluded {excluded_iot_count} records from unequipped subcentres.")

# Determine which folder has the latest ANC registers
dir_options = [
    os.path.join(script_dir, "Total ANC data"),
    os.path.join(script_dir, "ANC 25-26")
]
anc_dir = dir_options[0] # default
latest_time = 0
for d in dir_options:
    if os.path.exists(d):
        files = glob.glob(os.path.join(d, "ANC_Line_list_Report_*.xlsx"))
        if files:
            mtimes = [os.path.getmtime(f) for f in files]
            if mtimes:
                max_mtime = max(mtimes)
                if max_mtime > latest_time:
                    latest_time = max_mtime
                    anc_dir = d

def get_max_date_from_anc(directory):
    files = glob.glob(os.path.join(directory, "ANC_Line_list_Report_*.xlsx"))
    max_d = pd.to_datetime('2026-05-07')
    for p in files:
        try:
            df_anc_temp = pd.read_excel(p, sheet_name="Report_1", skiprows=8)
            df_anc_temp = df_anc_temp[pd.to_numeric(df_anc_temp['S.No'], errors='coerce').notnull()]
            v_cols = [c for c in df_anc_temp.columns if str(c).startswith('ANC Visit Date')]
            for col in v_cols:
                parsed = pd.to_datetime(df_anc_temp[col], errors='coerce')
                if not parsed.empty:
                    d_val = parsed.max()
                    if pd.notnull(d_val) and d_val > max_d:
                        max_d = d_val
        except:
            pass
    return max_d

anc_max_date = get_max_date_from_anc(anc_dir)

# Generate weeks Thursday to Wednesday starting 2026-05-07
min_date = pd.to_datetime('2026-05-07')
max_date_iot = df_iot['ANC Date'].max()
max_date = max(max_date_iot, anc_max_date)
print(f"Generating weeks from {min_date.strftime('%Y-%m-%d')} to {max_date.strftime('%Y-%m-%d')} (Max IoT: {max_date_iot.strftime('%Y-%m-%d')}, Max ANC: {anc_max_date.strftime('%Y-%m-%d')})")

weeks = []
current_start = min_date
week_idx = 1
while current_start <= max_date:
    current_end = current_start + pd.Timedelta(days=6)
    
    # Calculate total distributed devices dynamically up to this week's end date
    w_end_dt = current_end
    devices = 0
    # Segaon
    segaon_date = block_dates.get("Segaon", pd.to_datetime("2026-05-18"))
    if w_end_dt >= segaon_date:
        devices += 16
    # Bhikangaon
    bhik_date = block_dates.get("Bhikangaon", pd.to_datetime("2026-05-21"))
    if w_end_dt >= bhik_date:
        devices += 14
    # Kasrawad
    kasr_date = block_dates.get("Kasrawad", pd.to_datetime("2026-06-24"))
    if w_end_dt >= kasr_date:
        devices += 17
        
    weeks.append({
        "no": week_idx,
        "start": current_start.strftime('%Y-%m-%d'),
        "end": current_end.strftime('%Y-%m-%d'),
        "label": f"W{week_idx} ({current_start.strftime('%b %d')} - {current_end.strftime('%b %d')})",
        "devices": devices
    })
    current_start = current_start + pd.Timedelta(days=7)
    week_idx += 1

# Staff mapping for equipped ANMs to match register Staff Name column
subcentre_anm_names = {
    'CHC Kasrawad': ['maya mandloi', 'pinki badole'],
    'SHC AHIR DHAMNOD New': ['nargis khan'],
    'SHC Andad': ['reena mujalde'],
    'SHC Anjangaon': ['saroj chouhan'],
    'SHC Badgao New': ['komal khede'],
    'SHC Balakwada': ['santoshi soni', 'sonakshi soni'],
    'SHC Balsamund': ['seema sen', 'najmin pathan', 'najmeen pthan'],
    'SHC Bamandi': ['nirmala durve', 'nirmla leikey'],
    'SHC Baneehar New': ['laxmi mandloi'],
    'SHC Barslay New': ['tabasum makrani', 'sunita yadav'],
    'SHC Besarkund': ['sandhya soni', 'sandhya sohani'],
    'SHC Bhadwali': ['radha taver', 'radha taware'],
    'SHC Bhikangaon B': ['jayshree birla', 'jayshri birle'],
    'SHC Bhilgaon': ['mamta more', 'mamta morey'],
    'SHC Bhoinda': ['durga prajapat'],
    'SHC Bither': ['madhubala kalme'],
    'SHC Choti Kasrawad New': ['leena takur', 'leena thakur'],
    'SHC Dalki': ['anita mukati'],
    'SHC Dasnawal': ['yashoda gole'],
    'SHC Devala': ['sarita', 'sarita asky'],
    'SHC Eagriya New': ['anita kiradiya', 'anit kirade'],
    'SHC Gandhawad': ['sunita khode', 'savita khode'],
    'SHC Jamothi New': ['sangeeta saite'],
    'SHC Jojalwadi': ['maaya dabar', 'maya ruwaya'],
    'SHC Kakadgaon New': ['ranu jadhaw', 'rani jadhaw'],
    'SHC Keli': ['seven mandloi', 'pinkiy chouhan'],
    'SHC Khamkheda': ['anita chouhan'],
    'SHC Lohari': ['ragini andelkar'],
    'SHC Magarkhedi': ['anita sharma'],
    'SHC Maltar': ['ranjana solanki', 'ranyanel'],
    'SHC Mogawan New': ['madhuri chouhan'],
    'SHC Mohankhedi': ['manisha mandloi', 'manisha pawar'],
    'SHC Nargaon': ['kamla brahmne', 'kamla brahmane'],
    'SHC Palasi New1': ['tara awase'],
    'SHC Panali': ['shashikla chouhan', 'shashikala chouhan'],
    'SHC Panwada': ['preeti patidar'],
    'SHC Poi New': ['rajni patidar', 'rajni palir'],
    'SHC Pokharabad': ['amrita kharte', 'amrta kharte'],
    'SHC Rasgaon': ['ashika chouhan'],
    'SHC Sangvi': ['barki bamniya', 'barkha jamele'],
    'SHC Segaon (B)': ['manisha mandoli', 'manisha mandloi'],
    'SHC Shakargaon': ['rekha garde', 'rekha gaarde'],
    'SHC Shrikhandi': ['saya dabar', 'sarda dawar'],
    'SHC Sirali': ['meena hirve'],
    'SHC Talakpura': ['rihana shekh', 'priya mujalde'],
    'SHC Temala New': ['imla nargawe', 'imla nargave']
}

# 3. Load the 3 overall ANC line list files to count overall checkups
anc_files = glob.glob(os.path.join(anc_dir, "ANC_Line_list_Report_*.xlsx"))

overall_visits = [] # list of dicts: {"subcentre": ..., "block": ..., "date": ..., "month": ...}

print("\n--- Loading Overall ANC Line List Reports ---")
for path in anc_files:
    print(f"Reading file: {os.path.basename(path)}")
    df_anc = pd.read_excel(path, sheet_name="Report_1", skiprows=8)
    df_anc = df_anc[pd.to_numeric(df_anc['S.No'], errors='coerce').notnull()]
    
    # Identify visit date columns
    visit_cols = [c for c in df_anc.columns if str(c).startswith('ANC Visit Date')]
    print(f"  Found {len(visit_cols)} visit date columns.")
    
    # Process each row
    for _, row in df_anc.iterrows():
        raw_sub = str(row['Health Sub Centre Name']).strip()
        subcentre = map_subcentre(raw_sub)
        
        # Only process if this is one of our equipped subcentres
        if subcentre in equipped_subcentres:
            block_name = equipped_subcentres[subcentre]
            for col in visit_cols:
                val = row[col]
                if pd.notnull(val):
                    # Only count consultations conducted by an ANM
                    suffix = col.replace('ANC Visit Date', '')
                    cond_col = 'ANC Conducted By' + suffix
                    if cond_col in row:
                        cond_by = str(row[cond_col]).lower()
                        if 'anm' not in cond_by:
                            continue
                            
                    # Only count consultations conducted by the specific equipped ANM(s)
                    staff_col = 'Staff Name' + suffix
                    if staff_col in row:
                        staff_name = str(row[staff_col]).strip().lower()
                        allowed_names = subcentre_anm_names.get(subcentre, [])
                        if not any(n in staff_name for n in allowed_names):
                            continue

                    # Parse date safely
                    try:
                        v_date = pd.to_datetime(val)
                        dist_date = block_dates.get(block_name)
                        if dist_date and v_date >= dist_date and v_date <= pd.to_datetime(weeks[-1]["end"]):
                            overall_visits.append({
                                "subcentre": subcentre,
                                "block": block_name,
                                "date": v_date.strftime('%Y-%m-%d'),
                                "month": v_date.strftime('%B')
                            })
                    except Exception as e:
                        pass

print(f"Loaded a total of {len(overall_visits)} overall checkups done at active IoT subcentres in the timeframe.")

# Primary assigned ANM mapping for equipped subcentres
subcentre_anm_assigned = {
    'CHC Kasrawad': 'Pinki Badole',
    'SHC AHIR DHAMNOD New': 'Nargish Khan',
    'SHC Andad': 'Reena Mujalde',
    'SHC Anjangaon': 'Saroj Chouhan',
    'SHC Badgao New': 'Komal Khede',
    'SHC Balakwada': 'Sonakshi Soni',
    'SHC Balsamund': 'Seema Sen',
    'SHC Bamandi': 'Nirmla Leikey',
    'SHC Baneehar New': 'Laxmi Mandloi',
    'SHC Barslay New': 'Sunita Yadav',
    'SHC Besarkund': 'Sandhya Sohani',
    'SHC Bhadwali': 'Radha Taware',
    'SHC Bhikangaon B': 'Jayshri Birle',
    'SHC Bhilgaon': 'Mamta Morey',
    'SHC Bhoinda': 'Durga Prajapat',
    'SHC Bither': 'Madhubala Kalme',
    'SHC Choti Kasrawad New': 'Leena Thakur',
    'SHC Dalki': 'Anita Mukati',
    'SHC Dasnawal': 'Yashoda Gole',
    'SHC Devala': 'Sarita Asky',
    'SHC Eagriya New': 'Anit Kirade',
    'SHC Gandhawad': 'Savita Khode',
    'SHC Jamothi New': 'Sangeeta Saite',
    'SHC Jojalwadi': 'Maya Ruwaya',
    'SHC Kakadgaon New': 'Rani Jadhaw',
    'SHC Keli': 'Pinkiy Chouhan',
    'SHC Khamkheda': 'Anita Chouhan',
    'SHC Lohari': 'Ragini Andelkar',
    'SHC Magarkhedi': 'Anita Sharma',
    'SHC Maltar': 'Ranjana Solanki',
    'SHC Mogawan New': 'Madhuri Chouhan',
    'SHC Mohankhedi': 'Manisha Pawar',
    'SHC Nargaon': 'Kamla Brahmane',
    'SHC Palasi New1': 'Tara Awase',
    'SHC Panali': 'Shashikala Chouhan',
    'SHC Panwada': 'Preeti Patidar',
    'SHC Poi New': 'Rajni Palir',
    'SHC Pokharabad': 'Amrta Kharte',
    'SHC Rasgaon': 'Ashika Chouhan',
    'SHC Sangvi': 'Barkha Jamele',
    'SHC Segaon (B)': 'Manisha Mandloi',
    'SHC Shakargaon': 'Rekha Gaarde',
    'SHC Shrikhandi': 'Sarda Dawar',
    'SHC Sirali': 'Meena Hirve',
    'SHC Talakpura': 'Rihana Shekh',
    'SHC Temala New': 'Imla Nargave'
}

# Pre-populate subcentres array for the frontend with the 46 standard subcentres
subcentres_list = []
for s, b in equipped_subcentres.items():
    # Find facility name and user name from IoT records if possible
    fac = "SHC"
    anm = subcentre_anm_assigned.get(s, "")
    for r in records:
        if r["sub_facility"] == s:
            fac = r["facility"]
            if not anm and r.get("user_name"):
                anm = r["user_name"]
            break
    subcentres_list.append({
        "name": s,
        "block": b,
        "facility": fac,
        "anm_name": anm
    })

# Write JSON data to file
now_dt = datetime.datetime.now()
last_updated_str = now_dt.strftime('%d-%m-%Y')

data_out = {
    "generated_at": now_dt.isoformat(),
    "last_updated_date": last_updated_str,
    "records": records,
    "weeks": weeks,
    "subcentres": subcentres_list,
    "overall_visits": overall_visits
}

output_path = os.path.join(script_dir, "dashboard_data.js")
with open(output_path, "w", encoding="utf-8") as f:
    f.write("const dashboardData = ")
    json.dump(data_out, f, indent=2)
    f.write(";\n")

print(f"\nSuccessfully generated dashboard_data.js with:")
print(f" - Last update: {last_updated_str}")
print(f" - {len(records)} IoT records")
print(f" - {len(weeks)} weeks")
print(f" - {len(subcentres_list)} subcentres")
print(f" - {len(overall_visits)} overall visits")

# 4. Generate Weekly format summary and write to Weekly format.csv.xlsx
weekly_rows = []
for w in weeks:
    w_start = w["start"]
    w_end = w["end"]
    
    # Filter IoT records falling inside this week range
    week_recs = [r for r in records if r["anc_date"] and w_start <= r["anc_date"] <= w_end]
    
    # Filter overall register checkups falling inside this week range
    week_overall = [v for v in overall_visits if w_start <= v["date"] <= w_end]
    
    total_contacts = len(week_overall)
    if total_contacts < len(week_recs):
        total_contacts = len(week_recs)
        
    being_used = len(set(r["sub_facility"] for r in week_recs if r["has_iot"]))
    weighing_scale_used = sum(1 for r in week_recs if r["weight_iot"] is not None)
    bp_machine_used = sum(1 for r in week_recs if r["bp_sys_iot"] is not None)
    
    pih = sum(1 for r in week_recs if r["is_pih"])
    severe_anemia = sum(1 for r in week_recs if r["is_severe_anemia"])
    weight_under = sum(1 for r in week_recs if r["is_underweight"])
    
    excel_start = pd.to_datetime(w_start).strftime('%#m/%#d/%Y')
    excel_end = pd.to_datetime(w_end).strftime('%#m/%#d/%Y')
    
    weekly_rows.append({
        "Date from": excel_start,
        "Date to": excel_end,
        "Total distributed": w["devices"],
        "Being used": being_used,
        "Total ANC contacts": total_contacts,
        "Weighing Scale Used": weighing_scale_used,
        "BP Machine Used": bp_machine_used,
        "PIH": pih,
        "Weight <40 kg": weight_under
    })

df_weekly = pd.DataFrame(weekly_rows)
weekly_format_path = os.path.join(script_dir, "Weekly format.csv.xlsx")
try:
    df_weekly.to_excel(weekly_format_path, sheet_name="Weekly format", index=False)
    print(f"\nSuccessfully updated Weekly format Excel file:")
    print(f" - Saved to: {weekly_format_path}")
    print(f" - Total rows written: {len(weekly_rows)}")
except PermissionError:
    print(f"\n[WARNING] Could not update Weekly format Excel file because it is currently open in Excel: {weekly_format_path}")
    print("Please close Excel and run the compiler again to update this file!")

# 5. Generate Standalone Dashboard (index.html and Sankalp_Dashboard_Sharable.html)
standalone_html_path = os.path.join(script_dir, "index.html")
sharable_html_path = os.path.join(script_dir, "Sankalp_Dashboard_Sharable.html")

# Download exceljs.min.js if not present
exceljs_path = os.path.join(script_dir, "exceljs.min.js")
if not os.path.exists(exceljs_path):
    try:
        import urllib.request
        print("Downloading exceljs.min.js for offline Excel generation support...")
        urllib.request.urlretrieve("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js", exceljs_path)
    except Exception as e:
        print(f"Could not download exceljs: {e}")

css_content = open(os.path.join(script_dir, "index.css"), "r", encoding="utf-8").read()
chart_js_content = open(os.path.join(script_dir, "chart.js"), "r", encoding="utf-8").read()
exceljs_content = ""
if os.path.exists(exceljs_path):
    exceljs_content = open(exceljs_path, "r", encoding="utf-8").read()
dashboard_js_content = open(os.path.join(script_dir, "dashboard.js"), "r", encoding="utf-8").read()
data_js_str = f"const dashboardData = {json.dumps(data_out)};"

with open(os.path.join(script_dir, "index.html"), "r", encoding="utf-8") as f:
    html_template = f.read()

# Replace external CSS link with inline style tag
html_template = html_template.replace(
    '<link rel="stylesheet" href="index.css">',
    f'<style>\n{css_content}\n</style>'
)

# Replace external script tags with inline scripts
html_template = html_template.replace(
    '<script src="chart.js"></script>',
    f'<script>\n{chart_js_content}\n</script>'
)

html_template = html_template.replace(
    '<script src="exceljs.min.js"></script>',
    f'<script>\n{exceljs_content}\n</script>'
)

html_template = html_template.replace(
    '<script src="dashboard_data.js"></script>',
    f'<script>\n{data_js_str}\n</script>'
)

html_template = html_template.replace(
    '<script src="dashboard.js"></script>',
    f'<script>\n{dashboard_js_content}\n</script>'
)

with open(standalone_html_path, "w", encoding="utf-8") as f:
    f.write(html_template)

with open(sharable_html_path, "w", encoding="utf-8") as f:
    f.write(html_template)

print(f"\nSuccessfully generated Standalone HTML Dashboard:")
print(f" - Saved to: {standalone_html_path}")
print(f" - Also saved to: {sharable_html_path}")

# 6. Generate HRP Line List Excel File
hrp_excel_path = os.path.join(script_dir, "HRP_Line_List.xlsx")

pih_rows = []
under_rows = []

for r in records:
    # PIH HRP check: Systolic >= 140 or Diastolic >= 90 from IoT readings
    sys_iot = r.get("bp_sys_iot")
    dia_iot = r.get("bp_dia_iot")
    is_pih_iot = False
    try:
        if sys_iot is not None and float(sys_iot) >= 140:
            is_pih_iot = True
        if dia_iot is not None and float(dia_iot) >= 90:
            is_pih_iot = True
    except ValueError:
        pass

    if is_pih_iot:
        pih_rows.append({
            "Se. No.": r["id"],
            "ANC Date": pd.to_datetime(r["anc_date"]).strftime('%#m/%#d/%Y'),
            "Block": r["block"],
            "Facility": r["facility"],
            "Sub Facility": r["sub_facility"],
            "ANM Name": r["user_name"],
            "MPID": r["mpid"],
            "ANC No.": r["anc_no"],
            "BP Systolic (IOT)": r["bp_sys_iot"],
            "BP Diastolic (IOT)": r["bp_dia_iot"],
            "BP Systolic (Manual)": r["bp_sys"],
            "BP Diastolic (Manual)": r["bp_dia"]
        })

    # Underweight HRP check: Weight < 40 kg from IoT readings
    w_iot = r.get("weight_iot")
    is_under_iot = False
    try:
        if w_iot is not None and float(w_iot) < 40:
            is_under_iot = True
    except ValueError:
        pass

    if is_under_iot:
        under_rows.append({
            "Se. No.": r["id"],
            "ANC Date": pd.to_datetime(r["anc_date"]).strftime('%#m/%#d/%Y'),
            "Block": r["block"],
            "Facility": r["facility"],
            "Sub Facility": r["sub_facility"],
            "ANM Name": r["user_name"],
            "MPID": r["mpid"],
            "ANC No.": r["anc_no"],
            "Weight (IOT)": r["weight_iot"],
            "Weight (Manual)": r["weight"]
        })

df_pih_hrp = pd.DataFrame(pih_rows)
df_under_hrp = pd.DataFrame(under_rows)

try:
    with pd.ExcelWriter(hrp_excel_path, engine='openpyxl') as writer:
        df_pih_hrp.to_excel(writer, sheet_name="PIH", index=False)
        df_under_hrp.to_excel(writer, sheet_name="Underweight", index=False)
    print(f"\nSuccessfully generated HRP Line List Excel file:")
    print(f" - Saved to: {hrp_excel_path}")
    print(f" - PIH HRP records written: {len(pih_rows)}")
    print(f" - Underweight HRP records written: {len(under_rows)}")
except PermissionError:
    print(f"\n[WARNING] Could not update HRP Line List Excel file because it is currently open in Excel: {hrp_excel_path}")
    print("Please close Excel and run the compiler again to update this file!")

# 7. Automatically commit and push updated project files to GitHub
print("\n--- Synchronizing updates with GitHub repository ---")
try:
    # Check git status first
    status_proc = subprocess.run(["git", "status", "--porcelain"], cwd=script_dir, capture_output=True, text=True)
    if status_proc.returncode == 0:
        if not status_proc.stdout.strip():
            print("Working tree clean, no file changes to commit to GitHub.")
        else:
            print("Detected modified project files. Staging and committing...")
            subprocess.run(["git", "add", "."], cwd=script_dir, check=True)
            commit_msg = f"Auto-update dashboard data ({last_updated_str})"
            commit_proc = subprocess.run(["git", "commit", "-m", commit_msg], cwd=script_dir, capture_output=True, text=True)
            if commit_proc.returncode == 0:
                print(f"Committed changes: '{commit_msg}'")
                print("Pushing to GitHub remote (origin)...")
                push_proc = subprocess.run(["git", "push", "origin", "main"], cwd=script_dir, capture_output=True, text=True)
                if push_proc.returncode == 0:
                    print("Successfully pushed latest updates to GitHub repository!")
                    if push_proc.stdout.strip():
                        print(push_proc.stdout.strip())
                else:
                    # Try fallback without specifying branch if main doesn't match default
                    push_proc2 = subprocess.run(["git", "push"], cwd=script_dir, capture_output=True, text=True)
                    if push_proc2.returncode == 0:
                        print("Successfully pushed latest updates to GitHub repository!")
                    else:
                        print(f"[WARNING] Git push failed:\n{push_proc.stderr or push_proc2.stderr}")
            else:
                print(f"[WARNING] Git commit failed:\n{commit_proc.stderr}")
    else:
        print(f"[WARNING] Git status check failed:\n{status_proc.stderr}")
except FileNotFoundError:
    print("[WARNING] Git is not installed or not available in PATH. Skipping git push.")
except Exception as e:
    print(f"[WARNING] Unexpected error while pushing to GitHub: {e}")



