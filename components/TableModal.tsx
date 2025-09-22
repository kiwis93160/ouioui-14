import React, { useState, useEffect } from 'react';
import Card from './ui/Card';
import { Loader2 } from 'lucide-react';
import type { EntityId, Table, TablePayload } from '../types';

interface TableModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: TablePayload, isNew: boolean) => Promise<void>;
    existingTable: Pick<Table, 'id' | 'nom' | 'capacite'> | null;
    allTables: Table[];
}

const TableModal: React.FC<TableModalProps> = ({ isOpen, onClose, onSave, existingTable, allTables }) => {
    const [id, setId] = useState('');
    const [nom, setNom] = useState('');
    const [capacite, setCapacite] = useState('');
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const isNew = !existingTable;

    useEffect(() => {
        if (isOpen) {
            if (existingTable) {
                setId(String(existingTable.id));
                setNom(existingTable.nom);
                setCapacite(String(existingTable.capacite));
            } else {
                const numericIds = allTables
                    .map(table => Number.parseInt(String(table.id), 10))
                    .filter(n => Number.isFinite(n) && n < 90);
                const nextId = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 1;
                setId(String(nextId));
                setNom(`Mesa ${nextId}`);
                setCapacite('2');
            }
            setError('');
        }
    }, [existingTable, isOpen, allTables]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        const sanitizedId: EntityId = id.trim();
        const numId = Number.parseInt(sanitizedId, 10);
        const numCapacite = parseInt(capacite, 10);

        if (!Number.isFinite(numId) || numId <= 0 || numId >= 90) {
            setError("El número de mesa debe ser un número positivo menor que 90.");
            return;
        }
        if (isNew && allTables.some(t => String(t.id) === sanitizedId)) {
            setError("Este número de mesa ya existe.");
            return;
        }
        if (isNaN(numCapacite) || numCapacite <= 0) {
            setError("La capacidad debe ser un número positivo.");
            return;
        }
        if (!nom.trim()) {
            setError("El nombre de la mesa es obligatorio.");
            return;
        }

        setIsSaving(true);
        try {
            await onSave({ id: sanitizedId, nom: nom.trim(), capacite: numCapacite }, isNew);
            onClose();
        } catch (err: any) {
            setError(err.message || "Error al guardar la mesa.");
        } finally {
            setIsSaving(false);
        }
    };
    
    const inputClasses = "mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm";

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
            <Card className="w-full max-w-md">
                <h2 className="text-xl font-bold mb-4">{isNew ? "Añadir Nueva Mesa" : "Modificar Mesa"}</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {isNew ? (
                        <input type="hidden" value={id} />
                    ) : (
                        <div>
                            <label className="block text-sm font-medium">Número de Mesa</label>
                            <input type="number" value={id} className={inputClasses} disabled={true} required />
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium">Nombre de la Mesa</label>
                        <input type="text" value={nom} onChange={e => setNom(e.target.value)} className={inputClasses} required />
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Capacidad</label>
                        <input type="number" value={capacite} onChange={e => setCapacite(e.target.value)} className={inputClasses} required />
                    </div>

                    {error && <p className="text-red-500 text-sm">{error}</p>}

                    <div className="flex justify-end space-x-2 pt-2">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500">Cancelar</button>
                        <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-300 flex items-center">
                           {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                           Guardar
                        </button>
                    </div>
                </form>
            </Card>
        </div>
    );
};

export default TableModal;
