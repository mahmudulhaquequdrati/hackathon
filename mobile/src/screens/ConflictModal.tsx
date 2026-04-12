import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import type { PendingConflict } from '../lib/useSupplyStore';

interface Props {
  visible: boolean;
  conflicts: PendingConflict[];
  onResolve: (supplyId: string, field: string, chosenValue: unknown, choice: 'local' | 'remote') => void;
  onDismiss: () => void;
}

export default function ConflictModal({ visible, conflicts, onResolve, onDismiss }: Props) {
  if (conflicts.length === 0) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.overlay}>
        <View style={s.modal}>
          <View style={s.header}>
            <Text style={s.title}>Sync Conflicts</Text>
            <Text style={s.subtitle}>
              {conflicts.length} field{conflicts.length > 1 ? 's' : ''} had concurrent edits
            </Text>
          </View>

          <ScrollView style={s.list}>
            {conflicts.map((c, i) => (
              <View key={`${c.supplyId}-${c.field}-${i}`} style={s.card}>
                <Text style={s.supplyName}>{c.supplyName}</Text>
                <Text style={s.fieldName}>Field: {c.field}</Text>

                <View style={s.valuesRow}>
                  {/* Local value */}
                  <TouchableOpacity
                    style={[s.valueCard, s.localCard]}
                    onPress={() => onResolve(c.supplyId, c.field, c.localValue, 'local')}
                  >
                    <Text style={s.valueLabel}>YOUR VALUE</Text>
                    <Text style={s.valueText}>{String(c.localValue)}</Text>
                    <Text style={s.keepText}>Keep This</Text>
                  </TouchableOpacity>

                  <Text style={s.vs}>vs</Text>

                  {/* Remote value */}
                  <TouchableOpacity
                    style={[s.valueCard, s.remoteCard]}
                    onPress={() => onResolve(c.supplyId, c.field, c.remoteValue, 'remote')}
                  >
                    <Text style={s.valueLabel}>REMOTE VALUE</Text>
                    <Text style={s.valueText}>{String(c.remoteValue)}</Text>
                    <Text style={s.keepText}>Keep This</Text>
                  </TouchableOpacity>
                </View>

                <Text style={s.autoNote}>
                  Auto-resolved: {c.winner} value won (LWW)
                </Text>
              </View>
            ))}
          </ScrollView>

          <TouchableOpacity style={s.dismissBtn} onPress={onDismiss}>
            <Text style={s.dismissText}>Accept All Auto-Resolutions</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: 30,
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f59e0b',
  },
  subtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
  list: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  card: {
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  supplyName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f3f4f6',
  },
  fieldName: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
    marginBottom: 10,
  },
  valuesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  valueCard: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  localCard: {
    backgroundColor: 'rgba(59,130,246,0.1)',
    borderColor: '#2563eb',
  },
  remoteCard: {
    backgroundColor: 'rgba(168,85,247,0.1)',
    borderColor: '#7c3aed',
  },
  vs: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: 'bold',
    marginHorizontal: 8,
  },
  valueLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#9ca3af',
    letterSpacing: 1,
    marginBottom: 4,
  },
  valueText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  keepText: {
    fontSize: 11,
    color: '#60a5fa',
    fontWeight: '600',
  },
  autoNote: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 8,
    fontStyle: 'italic',
  },
  dismissBtn: {
    backgroundColor: '#374151',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  dismissText: {
    color: '#d1d5db',
    fontSize: 14,
    fontWeight: '600',
  },
});
