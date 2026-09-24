import React, { useEffect, useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { db, auth } from '../firebase';
import { collection, getDocs, query, where, addDoc, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const CampaignOptions = ({ campaignId }) => {
  const [emails, setEmails] = useState([]);
  const [selectedSender, setSelectedSender] = useState('');
  const [subject, setSubject] = useState('Ваше навчальне навантаження на семестр');
  const [leads, setLeads] = useState([]);
  
  const [matchedData, setMatchedData] = useState([]);
  
  // Нові стани для нерозпізнаних викладачів
  const [unmatchedGroups, setUnmatchedGroups] = useState([]);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [headerRowData, setHeaderRowData] = useState(null);

  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(null); 
  const [sentIndexes, setSentIndexes] = useState(new Set());
  const cancelRef = useRef(false); 

  useEffect(() => {
    const fetchData = async () => {
      const emailSnap = await getDocs(query(collection(db, 'emails'), where('ownerUid', '==', auth.currentUser?.uid)));
      setEmails(emailSnap.docs.map(document => ({ id: document.id, ...document.data() })));
      
      const leadsSnap = await getDocs(query(collection(db, 'leads'), where('campaignId', '==', campaignId)));
      setLeads(leadsSnap.docs.map(document => document.data()));
    };
    fetchData();
  }, [campaignId]);

  const normalizeAbbrev = (str) => {
    if (!str) return '';
    let s = str.toString().toUpperCase().trim();
    const en = "ABCEHIKMOPTX";
    const ua = "АВСЕНІКМОРТХ";
    for (let i = 0; i < en.length; i++) {
      s = s.split(en[i]).join(ua[i]);
    }
    return s.replace(/[^А-ЯІЇЄҐ0-9]/g, '');
  };

  // Винесені функції генерації HTML
  const generateTableHtml = (headerRow, dataRows) => {
    let htmlTable = `<table border="1" style="border-collapse: collapse; width: 100%; max-width: 900px; font-family: Arial, sans-serif; font-size: 14px; border: 1px solid #cbd5e1; margin-top: 15px;">`;
    htmlTable += `<thead><tr style="background-color: #cbd5e1; color: #0f172a;">`;
    headerRow.forEach((cell) => {
      htmlTable += `<th style="padding: 10px 12px; border: 1px solid #94a3b8; text-align: left; font-weight: bold;">${cell !== undefined && cell !== null ? cell : ''}</th>`;
    });
    htmlTable += `</tr></thead><tbody>`;
    
    dataRows.forEach((r, rowIndex) => {
      const bgStyle = rowIndex % 2 === 0 ? 'background-color: #ffffff;' : 'background-color: #f8fafc;';
      htmlTable += `<tr style="${bgStyle}">`;
      r.forEach((cell) => {
        const isTotalRowInTable = r.some(c => c?.toString().toLowerCase().includes('підсумок') || c?.toString().toLowerCase().includes('всього'));
        const fontWeight = isTotalRowInTable ? 'font-weight: bold; color: #1e293b; background-color: #f1f5f9;' : 'color: #334155;';
        htmlTable += `<td style="padding: 10px 12px; border: 1px solid #cbd5e1; text-align: left; ${fontWeight}">${cell !== undefined && cell !== null ? cell : ''}</td>`;
      });
      htmlTable += '</tr>';
    });
    htmlTable += `</tbody></table>`;
    return htmlTable;
  };

  const generateEmailHtml = (firstName, lastName, htmlTable) => {
    return `
      <div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px;">
        <p style="font-size: 16px;">Доброго дня, <strong>${firstName} ${lastName || ''}</strong>!</p>
        <p style="font-size: 14px; color: #475569;">Надсилаємо витяг із загального плану розподілу навчального навантаження:</p>
        ${htmlTable}
        <br><hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 12px; color: #94a3b8;">Цей лист згенеровано автоматично.</p>
      </div>
    `;
  };

  const processRows = (rows) => {
    if (!rows || rows.length === 0) return;

    const headerRow = rows[0]; 
    setHeaderRowData(headerRow);
    const grouped = {};
    const knownLeads = leads.map(l => normalizeAbbrev(l.abbreviation)).filter(Boolean);
    
    let currentAbbrev = '';

    rows.forEach((row, index) => {
      if (!Array.isArray(row)) return;
      if (index === 0) return; 

      let foundKnownLead = null;
      let possibleUnknownLead = null;
      let isTotalRow = false;

      for (let cell of row) {
        if (!cell) continue;
        const cellStr = cell.toString().trim();
        const norm = normalizeAbbrev(cellStr);
        
        if (knownLeads.includes(norm)) {
          foundKnownLead = norm;
          break; 
        }
        
        if (cellStr.toLowerCase().includes('підсумок') || cellStr.toLowerCase().includes('всього') || cellStr.toLowerCase().includes('разом')) {
          isTotalRow = true;
        }

        const justLetters = cellStr.replace(/[^А-ЯІЇЄҐA-Zа-яіїєґa-z]/g, '');
        if (justLetters.length >= 2 && justLetters.length <= 4 && justLetters === justLetters.toUpperCase() && cellStr.length < 10) {
          possibleUnknownLead = norm;
        }
      }

      const nonEmptyCellsCount = row.filter(c => c !== null && c !== undefined && c.toString().trim() !== '').length;
      const hasNumbers = row.some(c => c !== null && /\d/.test(c.toString()));
      if (nonEmptyCellsCount === 1 && !hasNumbers) {
        const val = row.find(c => c !== null && c !== undefined && c.toString().trim() !== '');
        if (val) possibleUnknownLead = normalizeAbbrev(val.toString().trim());
      }

      if (foundKnownLead) {
        currentAbbrev = foundKnownLead; 
      } else if (possibleUnknownLead) {
        currentAbbrev = possibleUnknownLead; 
      }

      if (isTotalRow) {
        currentAbbrev = '';
      }

      if (currentAbbrev) {
        if (!grouped[currentAbbrev]) grouped[currentAbbrev] = [];
        grouped[currentAbbrev].push(row);
      }
    });

    const readyToSend = [];
    const processedAbbrevs = new Set();
    
    leads.forEach(lead => {
      const leadAbbrev = normalizeAbbrev(lead.abbreviation);
      
      if (grouped[leadAbbrev] && grouped[leadAbbrev].length > 0) {
        processedAbbrevs.add(leadAbbrev);
        const htmlTable = generateTableHtml(headerRow, grouped[leadAbbrev]);
        const emailHtmlBody = generateEmailHtml(lead.firstName, lead.lastName, htmlTable);

        readyToSend.push({ 
          to: lead.email, 
          name: lead.firstName, 
          lastName: lead.lastName,
          hasData: true,
          skipSending: false,
          htmlBody: emailHtmlBody,
          tableRows: [headerRow, ...grouped[leadAbbrev]],
          message: '' 
        });
      } else {
        readyToSend.push({
          to: lead.email,
          name: lead.firstName,
          lastName: lead.lastName,
          hasData: false,
          skipSending: false,
          htmlBody: '', 
          tableRows: [],
          message: `Доброго дня, ${lead.firstName || 'колего'}!\n\nПовідомляємо, що у загальному плані розподілу на цей семестр для вас наразі немає годин. Якщо у вас є питання, зверніться, будь ласка, до завідувача кафедри.`
        });
      }
    });

    // Формуємо список пропущених (невідомих) скорочень
    const unmatched = [];
    Object.keys(grouped).forEach(abbrev => {
      if (!processedAbbrevs.has(abbrev) && abbrev.length > 0) {
        unmatched.push({
          abbreviation: abbrev,
          rows: grouped[abbrev],
          tempFirstName: '',
          tempLastName: '',
          tempEmail: ''
        });
      }
    });

    readyToSend.sort((a, b) => {
      if (a.hasData === b.hasData) return 0;
      return a.hasData ? 1 : -1;
    });

    setMatchedData(readyToSend);
    setUnmatchedGroups(unmatched);
    setSentIndexes(new Set()); 
  };

  const handleUnmatchedChange = (index, field, value) => {
    setUnmatchedGroups(prev => {
      const updated = [...prev];
      updated[index][field] = value;
      return updated;
    });
  };

  const handleSaveUnmatched = async (index) => {
    const group = unmatchedGroups[index];
    if (!group.tempFirstName || !group.tempEmail) {
      return alert("Ім'я та Email є обов'язковими для додавання викладача!");
    }

    const newLead = {
      firstName: group.tempFirstName,
      lastName: group.tempLastName,
      email: group.tempEmail,
      abbreviation: group.abbreviation,
      campaignId: campaignId
    };

    const htmlTable = generateTableHtml(headerRowData, group.rows);
    const emailHtmlBody = generateEmailHtml(newLead.firstName, newLead.lastName, htmlTable);

    const newMatchedItem = {
      to: newLead.email,
      name: newLead.firstName,
      lastName: newLead.lastName,
      hasData: true,
      skipSending: false,
      htmlBody: emailHtmlBody,
      tableRows: [headerRowData, ...group.rows],
      message: ''
    };

    setMatchedData(prev => [newMatchedItem, ...prev]);
    setUnmatchedGroups(prev => prev.filter((_, i) => i !== index));

    try {
      await addDoc(collection(db, 'leads'), {
        ...newLead,
        ownerUid: auth.currentUser?.uid,
        createdAt: serverTimestamp()
      });
      setLeads(prev => [...prev, newLead]);
    } catch (error) {
      console.error("Не вдалося зберегти викладача в БД:", error);
    }
  };

  const handleCustomMessageChange = (index, newText) => {
    setMatchedData(prevData => {
      const newData = [...prevData];
      newData[index] = { ...newData[index], message: newText };
      return newData;
    });
  };

  const handleToggleSkip = (index) => {
    setMatchedData(prevData => {
      const newData = [...prevData];
      newData[index] = { 
        ...newData[index], 
        skipSending: !newData[index].skipSending 
      };
      return newData;
    });
  };

  const handleMasterFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        encoding: "UTF-8",
        skipEmptyLines: true,
        complete: (results) => processRows(results.data)
      });
    } else {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const wb = XLSX.read(evt.target.result, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsname], { header: 1, defval: "" });
        processRows(rows);
      };
      reader.readAsBinaryString(file);
    }
    e.target.value = null; 
  };

  const handleStop = () => {
    cancelRef.current = true;
  };

  const handleSend = async () => {
    if (!selectedSender) return alert('Оберіть пошту відправника!');
    if (matchedData.length === 0) return alert('Немає даних для відправки.');

    const senderAcc = emails.find(e => e.id === selectedSender);
    
    if (!senderAcc.smtpPassword && !senderAcc.appPassword && !senderAcc.password) {
      alert('❌ У вибраної пошти немає пароля додатку в базі даних! Додайте пароль у налаштуваннях пошти.');
      return;
    }

    setIsSending(true);
    cancelRef.current = false; 
    
    let successCount = Array.from(sentIndexes).filter(idx => !matchedData[idx].skipSending).length;
    let skippedCount = Array.from(sentIndexes).filter(idx => matchedData[idx].skipSending).length;
    let errorCount = 0; 

    for (let i = 0; i < matchedData.length; i++) {
      if (cancelRef.current) {
        alert(`🛑 Відправку зупинено!\nУспішно: ${successCount}\nПропущено: ${skippedCount}\nПомилок: ${errorCount}`);
        break;
      }

      if (sentIndexes.has(i)) {
        continue;
      }

      if (matchedData[i].skipSending) {
        skippedCount++;
        setSentIndexes(prev => {
          const newSet = new Set(prev);
          newSet.add(i);
          return newSet;
        });
        continue; 
      }

      setSendProgress({ 
        current: i + 1, 
        total: matchedData.length, 
        success: successCount, 
        skipped: skippedCount,
        error: errorCount,
        status: 'Відправляємо...' 
      });

      const finalHtmlContent = matchedData[i].hasData 
        ? matchedData[i].htmlBody 
        : `
          <div style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px;">
            ${matchedData[i].message.replace(/\n/g, '<br/>')}
            <br><hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="font-size: 12px; color: #94a3b8;">Цей лист згенеровано автоматично.</p>
          </div>
        `;
      
      try {
        const response = await fetch(`${API_URL}/api/send-single`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderAccount: senderAcc,
            subject,
            emailData: {
              ...matchedData[i],
              htmlBody: finalHtmlContent
            }
          })
        });

        if (response.ok) {
          successCount++;
          setSentIndexes(prev => {
            const newSet = new Set(prev);
            newSet.add(i);
            return newSet;
          });

          try {
            await addDoc(collection(db, 'send_logs'), {
              campaignId,
              recipientEmail: matchedData[i].to,
              recipientName: matchedData[i].name,
              sentAt: serverTimestamp(),
              htmlContent: finalHtmlContent,
              ownerUid: auth.currentUser?.uid
            });

            await updateDoc(doc(db, 'campaigns', campaignId), {
              sent: increment(1)
            });
          } catch (logErr) {
            console.error("Не вдалося зберегти лог відправки:", logErr);
          }

        } else {
          errorCount++;
        }
      } catch (err) {
        console.error("Помилка при відправці:", err);
        errorCount++;
      }

      if (i < matchedData.length - 1 && !cancelRef.current) {
        setSendProgress({ 
          current: i + 1, 
          total: matchedData.length, 
          success: successCount, 
          skipped: skippedCount,
          error: errorCount,
          status: 'Очікування 3 сек...' 
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    if (!cancelRef.current) {
      alert(`✅ Роботу завершено!\nВідправлено: ${successCount}\nПропущено: ${skippedCount}\nПомилок: ${errorCount}`);
      if ((successCount + skippedCount) === matchedData.length) {
        setMatchedData([]); 
        setSentIndexes(new Set()); 
      }
    }
    
    setIsSending(false);
    setSendProgress(null);
  };

  const remainingCount = matchedData.length - sentIndexes.size;
  const isResuming = sentIndexes.size > 0 && remainingCount > 0;

  return (
    <div style={{ background: '#fff', borderRadius: '10px' }}>      
      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '8px' }}>
          Відправник (ваша пошта Gmail/LPNU):
        </label>
        <select 
          className="search-input"
          value={selectedSender} 
          onChange={e => setSelectedSender(e.target.value)}
        >
          <option value="">-- Оберіть пошту --</option>
          {emails.map(e => <option key={e.id} value={e.id}>{e.email}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <label style={{ fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '8px' }}>
          Тема листа:
        </label>
        <input 
          className="search-input"
          type="text" 
          value={subject} 
          onChange={e => setSubject(e.target.value)} 
        />
      </div>

      <div className="upload-zone">
        <span className="upload-icon">📊</span>
        <div className="upload-text">Завантажте загальну таблицю навантаження (.xlsx, .csv)</div>
        <div className="upload-subtext">Програма автоматично розріже її та підготує листи за скороченнями</div>
        <input type="file" accept=".csv, .xlsx, .xls" onChange={handleMasterFileUpload} />
      </div>

      {unmatchedGroups.length > 0 && (
        <div style={{ marginTop: '30px', padding: '24px', background: '#fffbeb', border: '2px dashed #f59e0b', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ color: '#d97706', marginTop: 0, marginBottom: '10px' }}>
            ⚠️ Знайдено невідомі скорочення ({unmatchedGroups.length})
          </h3>
          <p style={{ color: '#b45309', marginBottom: '20px', fontSize: '14px' }}>
            Ці частини навантаження не знайдено в базі. Заповніть дані, щоб програма їх запам'ятала та додала до поточної розсилки.
          </p>
          
          <button 
            onClick={() => setShowUnmatched(!showUnmatched)} 
            style={{ padding: '10px 20px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {showUnmatched ? "Сховати список" : "Переглянути та заповнити"}
          </button>

          {showUnmatched && (
            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              {unmatchedGroups.map((group, idx) => (
                <div key={idx} style={{ background: '#fff', padding: '15px', borderRadius: '8px', border: '1px solid #fcd34d', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                  <strong style={{ fontSize: '18px', color: '#b45309', minWidth: '80px' }}>{group.abbreviation}</strong>
                  <input
                    type="text" placeholder="Ім'я" className="search-input" 
                    style={{ width: '130px', margin: 0, padding: '8px' }}
                    value={group.tempFirstName} 
                    onChange={e => handleUnmatchedChange(idx, 'tempFirstName', e.target.value)}
                  />
                  <input
                    type="text" placeholder="Прізвище" className="search-input" 
                    style={{ width: '130px', margin: 0, padding: '8px' }}
                    value={group.tempLastName} 
                    onChange={e => handleUnmatchedChange(idx, 'tempLastName', e.target.value)}
                  />
                  <input
                    type="email" placeholder="Email" className="search-input" 
                    style={{ width: '220px', margin: 0, padding: '8px' }}
                    value={group.tempEmail} 
                    onChange={e => handleUnmatchedChange(idx, 'tempEmail', e.target.value)}
                  />
                  <button
                    onClick={() => handleSaveUnmatched(idx)}
                    style={{ padding: '9px 15px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    ➕ Додати
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {matchedData.length > 0 && (
        <div style={{ marginTop: '40px' }}>
          
          {isSending ? (
            <div style={{ padding: '24px', background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 'var(--radius-lg)', textAlign: 'center', marginBottom: '30px', boxShadow: 'var(--shadow-sm)' }}>
              <h4 style={{ color: '#d97706', margin: '0 0 15px 0', fontSize: '18px' }}>
                {sendProgress?.status} (Лист {sendProgress?.current} з {sendProgress?.total})
              </h4>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginBottom: '20px', fontSize: '15px' }}>
                <span style={{ color: '#047857', fontWeight: 'bold' }}>✅ Успішно: {sendProgress?.success}</span>
                <span style={{ color: '#475569', fontWeight: 'bold' }}>⏭️ Пропущено: {sendProgress?.skipped || 0}</span>
                <span style={{ color: '#b91c1c', fontWeight: 'bold' }}>❌ Помилок: {sendProgress?.error}</span>
              </div>
              <button 
                onClick={handleStop}
                style={{ padding: '12px 24px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontWeight: 'bold', cursor: 'pointer', transition: 'var(--transition)' }}
                onMouseOver={e => e.currentTarget.style.background = '#b91c1c'}
                onMouseOut={e => e.currentTarget.style.background = '#dc2626'}
              >
                🛑 ЗУПИНИТИ ВІДПРАВКУ
              </button>
            </div>
          ) : (
            <button 
              onClick={handleSend} 
              style={{ width: '100%', padding: '14px', background: isResuming ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : 'linear-gradient(135deg, var(--primary) 0%, #3730a3 100%)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '30px', boxShadow: 'var(--shadow-sm)', transition: 'var(--transition)' }}
              onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              {isResuming 
                ? `▶️ Продовжити розсилку (Залишилось ${remainingCount} листів)` 
                : `🚀 Запустити безпечну розсилку (${matchedData.length} листів)`
              }
            </button>
          )}

          <h3 style={{ color: 'var(--text-main)', marginBottom: '20px', fontSize: '20px' }}>Попередній перегляд ({matchedData.length} отримувачів)</h3>
          
          {matchedData.map((item, idx) => {
            const isSent = sentIndexes.has(idx);
            
            return (
              <div key={idx} style={{ marginBottom: '25px', border: isSent ? '2px solid #10b981' : (item.hasData ? '1px solid #e2e8f0' : '2px dashed #cbd5e1'), borderRadius: 'var(--radius-md)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', opacity: item.skipSending ? 0.6 : 1, transition: 'var(--transition)' }}>
                <div style={{ background: isSent ? '#d1fae5' : (item.hasData ? '#f8fafc' : '#ffffff'), padding: '12px 20px', borderBottom: isSent ? '1px solid #10b981' : '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--bg-sidebar)' }}>{item.hasData ? '📊' : '⚠️'} Отримувач:</strong> {item.name} {item.lastName || ''} <em style={{ color: 'var(--text-muted)' }}>({item.to})</em>
                    {!item.hasData && !isSent && (
                      <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#fef2f2', color: '#ef4444', borderRadius: '12px', fontWeight: '600' }}>
                        Немає навантаження
                      </span>
                    )}
                    {item.skipSending && (
                      <span style={{ fontSize: '12px', padding: '2px 8px', backgroundColor: '#f1f5f9', color: '#475569', borderRadius: '12px', fontWeight: '600' }}>
                        🚫 Пропущено
                      </span>
                    )}
                  </span>
                  {isSent && <span style={{ color: '#047857', fontWeight: 'bold', fontSize: '13px', background: '#a7f3d0', padding: '4px 10px', borderRadius: '20px' }}>✅ {item.skipSending ? 'Пропущено' : 'Надіслано'}</span>}
                </div>
                
                <div style={{ padding: '20px', overflowX: 'auto', opacity: isSent ? 0.6 : 1 }}>
                  {item.hasData ? (
                    <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', borderRadius: '4px', overflow: 'hidden' }}>
                      <tbody>
                        {item.tableRows.map((row, rIdx) => {
                          const isHeader = rIdx === 0;
                          return (
                            <tr key={rIdx} style={isHeader ? { backgroundColor: '#e2e8f0', fontWeight: 'bold', color: '#0f172a' } : {}}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} style={{ border: '1px solid #cbd5e1', padding: '8px 12px' }}>{cell}</td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div>
                      {!isSent && (
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '16px', fontSize: '14px', fontWeight: '600', color: '#475569' }}>
                          <input 
                            type="checkbox" 
                            checked={item.skipSending}
                            onChange={() => handleToggleSkip(idx)}
                            style={{ width: '16px', height: '16px', accentColor: '#ef4444' }}
                          />
                          Не надсилати лист (пропустити)
                        </label>
                      )}
                      
                      {!item.skipSending ? (
                        <div>
                          <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase' }}>
                            Текст повідомлення (можна редагувати):
                          </label>
                          <textarea
                            disabled={isSent}
                            value={item.message}
                            onChange={(e) => handleCustomMessageChange(idx, e.target.value)}
                            style={{
                              width: '100%', minHeight: '90px', padding: '12px', borderRadius: '8px',
                              border: '1px solid #cbd5e1', fontSize: '14px', fontFamily: 'inherit',
                              lineHeight: '1.5', color: '#334155', resize: 'vertical', outline: 'none',
                              boxSizing: 'border-box', backgroundColor: isSent ? '#f8fafc' : '#ffffff'
                            }}
                            onFocus={e => e.target.style.borderColor = '#3b82f6'}
                            onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                          />
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontStyle: 'italic' }}>
                          Цьому викладачу не буде надіслано жодних повідомлень.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CampaignOptions;