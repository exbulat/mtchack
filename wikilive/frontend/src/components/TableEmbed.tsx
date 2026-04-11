import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

interface TableEmbedProps {
  dstId: string;
  title?: string;
}

export default function TableEmbed({ dstId, title }: TableEmbedProps) {
  const [fields, setFields] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      try {
        const [fieldsData, recordsData] = await Promise.all([
          api.getFields(dstId),
          api.getRecords(dstId, 50),
        ]);
        if (!mounted) return;
        // mws то шлёт { data: ... }, то плоский json — подстраиваемся
        setFields(fieldsData?.data?.fields || fieldsData?.fields || []);
        setRecords(recordsData?.data?.records || recordsData?.records || []);
      } catch {
        if (mounted) {
          setFields([]);
          setRecords([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [dstId]);

  const normalizedFields = useMemo(
    () =>
      fields.map((f) => ({
        id: f.id || f.fieldId || f.name,
        name: f.name || f.fieldName || f.id,
      })),
    [fields]
  );

  const updateCell = async (recordId: string, fieldId: string, value: string) => {
    try {
      await api.updateRecords(dstId, {
        records: [
          {
            recordId,
            fields: { [fieldId]: value },
          },
        ],
      });
      setRecords((prev) =>
        prev.map((r) =>
          (r.recordId || r.id) === recordId
            ? {
                ...r,
                fields: { ...(r.fields || {}), [fieldId]: value },
              }
            : r
        )
      );
    } catch {
      // keep UI stable in MVP mode
    }
  };

  if (loading) {
    return <div className="table-embed">Загрузка таблицы...</div>;
  }

  return (
    <div className="table-embed">
      <div className="table-embed-header">
        <span>{title || `Таблица ${dstId}`}</span>
      </div>
      <table>
        <thead>
          <tr>
            {normalizedFields.map((field) => (
              <th key={field.id}>{field.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const recordId = record.recordId || record.id;
            const rowFields = record.fields || {};
            return (
              <tr key={recordId}>
                {normalizedFields.map((field) => (
                  <td key={`${recordId}-${field.id}`}>
                    <input
                      className="table-embed-cell-input"
                      defaultValue={String(rowFields[field.id] ?? '')}
                      onBlur={(e) => updateCell(recordId, field.id, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
