import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertFoodLogSchema, type InsertFoodLog } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateFoodLog } from "@/hooks/use-logs";
import { Plus, Loader2 } from "lucide-react";
import { z } from "zod";

const formSchema = insertFoodLogSchema.extend({
  userId: z.coerce.number(), // Ensure numeric coercion
  calories: z.coerce.number(),
  protein: z.coerce.number(),
  fat: z.coerce.number(),
  carbs: z.coerce.number(),
  weight: z.coerce.number(),
});

export function AddFoodDialog() {
  const [open, setOpen] = useState(false);
  const createLog = useCreateFoodLog();

  const form = useForm<InsertFoodLog>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      userId: 1, // Hardcoded for demo as per requirements
      foodName: "",
      mealType: "snack",
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      weight: 100,
    },
  });

  const onSubmit = (data: InsertFoodLog) => {
    createLog.mutate(data, {
      onSuccess: () => {
        setOpen(false);
        form.reset();
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="rounded-xl font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all">
          <Plus className="w-5 h-5 mr-2" />
          Add Food
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-display font-bold">Log Meal</DialogTitle>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="foodName"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Food Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Grilled Chicken Salad" className="rounded-xl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="mealType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Meal Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="rounded-xl">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="breakfast">Breakfast</SelectItem>
                        <SelectItem value="lunch">Lunch</SelectItem>
                        <SelectItem value="dinner">Dinner</SelectItem>
                        <SelectItem value="snack">Snack</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="weight"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Weight (g)</FormLabel>
                    <FormControl>
                      <Input type="number" className="rounded-xl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="col-span-2 grid grid-cols-4 gap-2">
                <FormField
                  control={form.control}
                  name="calories"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Calories</FormLabel>
                      <FormControl>
                        <Input type="number" className="rounded-lg text-sm" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="protein"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Protein</FormLabel>
                      <FormControl>
                        <Input type="number" className="rounded-lg text-sm" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fat"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Fat</FormLabel>
                      <FormControl>
                        <Input type="number" className="rounded-lg text-sm" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="carbs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Carbs</FormLabel>
                      <FormControl>
                        <Input type="number" className="rounded-lg text-sm" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full rounded-xl h-12 text-base font-semibold"
              disabled={createLog.isPending}
            >
              {createLog.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Logging...
                </>
              ) : (
                "Save Log"
              )}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
