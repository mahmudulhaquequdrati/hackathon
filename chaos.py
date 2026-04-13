import json
import random
import time
import threading
from flask import Flask, jsonify

app = Flask(__name__)

MAP_FILE = 'sylhet_map.json'
with open(MAP_FILE, 'r') as f:
    map_data = json.load(f)


def trigger_chaos():
    while True:
        time.sleep(30)

        safe_roads = [edge for edge in map_data['edges'] if edge['type'] == 'road' and not edge['is_flooded']]
        flooded_roads = [edge for edge in map_data['edges'] if edge['type'] == 'road' and edge['is_flooded']]

        event_type = random.choices(['flood', 'recede'], weights=[0.6, 0.4])[0]

        if event_type == 'flood' and safe_roads:

            target = random.choice(safe_roads)
            target['is_flooded'] = True

            target['original_weight'] = target.get('base_weight_mins', 45)
            target['base_weight_mins'] = 9999

            print(f"CHAOS EVENT: Flood! Route {target['id']} ({target['source']} -> {target['target']}) is washed out!")

        elif event_type == 'recede' and flooded_roads:
            # Clear a flooded road
            target = random.choice(flooded_roads)
            target['is_flooded'] = False

            # Restore the original driving time
            target['base_weight_mins'] = target.get('original_weight', 45)

            print(f"CHAOS EVENT: Water receded! Route {target['id']} ({target['source']} -> {target['target']}) is now clear!")

        else:
            print("Chaos Engine: Water levels are stable this cycle.")

chaos_thread = threading.Thread(target=trigger_chaos, daemon=True)
chaos_thread.start()



@app.route('/api/network/status', methods=['GET'])
def get_network_status():
    """Returns the live map with current flood statuses and edge weights."""
    return jsonify(map_data)

@app.route('/api/network/reset', methods=['POST'])
def reset_network():
    """Judges/Teams can hit this to reset the map to sunny conditions."""
    global map_data
    with open(MAP_FILE, 'r') as f:
        map_data = json.load(f)
    return jsonify({"status": "Success", "message": "The floodwaters have receded. Map reset."})

if __name__ == '__main__':
    print(" Hackfusion 2026: Digital Delta Chaos API is running!")
    print("Endpoint available at: http://127.0.0.1:5000/api/network/status")
    app.run(debug=False, port=5000)
