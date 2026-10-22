import { convertFromCzk, currencyDigits, formatCurrency, formatRateDate } from "@fapi/shared";
import { useState } from "react";
import { useRates } from "@/entities/exchange-rate";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";

const DEFAULT_CURRENCY = "EUR";

/** Shows a CZK amount converted with the current ČNB rate. */
export function CurrencyConverter({ totalMinor }: { totalMinor: number }) {
  const { data, isPending, isError } = useRates();
  const [code, setCode] = useState(DEFAULT_CURRENCY);

  if (isPending) return <p className="text-muted-foreground text-sm">Loading exchange rates…</p>;
  if (isError) {
    return <p className="text-muted-foreground text-sm">Exchange rates are currently unavailable.</p>;
  }

  const rate = data.rates.find((r) => r.code === code) ?? data.rates[0];
  if (!rate) return null;
  // Rounded once, to the decimals the currency is written with (3 for TND, 0 for JPY).
  const converted = convertFromCzk(totalMinor, rate, currencyDigits(rate.code));

  return (
    <div className="grid gap-3">
      <div className="flex items-end gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Select value={rate.code} onValueChange={setCode}>
            <SelectTrigger id="currency" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.rates.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  {r.code} · {r.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-2xl font-semibold" data-testid="converted-total">
          {formatCurrency(converted, rate.code)}
        </p>
      </div>
      <p className="text-muted-foreground text-xs">
        ČNB rate from {formatRateDate(data.date)}: {rate.amount} {rate.code} ={" "}
        {rate.rate.toLocaleString("cs-CZ")} CZK
      </p>
    </div>
  );
}
