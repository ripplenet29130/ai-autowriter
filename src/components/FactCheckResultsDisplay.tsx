import React from 'react';
import { AlertTriangle, CheckCircle, HelpCircle, ExternalLink, ShieldCheck } from 'lucide-react';
import { FactCheckResult } from '../types/factCheck';

interface FactCheckResultsDisplayProps {
    results: FactCheckResult[];
}

export const FactCheckResultsDisplay: React.FC<FactCheckResultsDisplayProps> = ({ results }) => {
    if (!results || results.length === 0) return null;

    const criticalIssues = results.filter(r => r.verdict === 'incorrect' && r.confidence >= 70).length;

    return (
        <div className="space-y-4">
            <div className={`p-4 rounded-xl border ${criticalIssues > 0 ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
                <div className="flex items-center space-x-2 mb-2">
                    <ShieldCheck className={`w-5 h-5 ${criticalIssues > 0 ? 'text-red-600' : 'text-green-600'}`} />
                    <h4 className={`font-semibold ${criticalIssues > 0 ? 'text-red-900' : 'text-green-900'}`}>
                        ファクトチェック結果レポート
                    </h4>
                </div>
                <p className={`text-sm ${criticalIssues > 0 ? 'text-red-800' : 'text-green-800'}`}>
                    {criticalIssues > 0
                        ? `重大な事実誤認が ${criticalIssues} 件検出されました。内容の修正を強く推奨します。`
                        : '重大な事実誤認は見つかりませんでした。'}
                </p>
            </div>

            <div className="space-y-3">
                {results.map((result, idx) => (
                    <div key={idx} className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-center space-x-2 mb-1">
                                    {result.verdict === 'correct' && <CheckCircle className="w-4 h-4 text-green-500" />}
                                    {result.verdict === 'incorrect' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                                    {(result.verdict === 'partially_correct' || result.verdict === 'unverified') && <HelpCircle className="w-4 h-4 text-amber-500" />}
                                    <span className="font-medium text-gray-900 text-sm">{result.claim}</span>
                                </div>

                                <p className="text-xs text-gray-600 mb-2 leading-relaxed">
                                    {result.explanation}
                                </p>

                                {result.correctInfo && (
                                    <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 mb-2 border-l-2 border-blue-400">
                                        <span className="font-bold text-blue-600 mr-1">修正情報:</span>
                                        {result.correctInfo}
                                    </div>
                                )}

                                {result.sourceUrl && (
                                    <a
                                        href={result.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-blue-600 hover:underline flex items-center"
                                    >
                                        出典を確認
                                        <ExternalLink className="w-2.5 h-2.5 ml-1" />
                                    </a>
                                )}
                            </div>

                            <div className="ml-3 text-right">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${result.verdict === 'correct' ? 'bg-green-100 text-green-700' :
                                        result.verdict === 'incorrect' ? 'bg-red-100 text-red-700' :
                                            'bg-amber-100 text-amber-700'
                                    }`}>
                                    {result.confidence}% {
                                        result.verdict === 'correct' ? '正確' :
                                            result.verdict === 'incorrect' ? '不正確' :
                                                result.verdict === 'partially_correct' ? '一部正確' : '未検証'
                                    }
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
