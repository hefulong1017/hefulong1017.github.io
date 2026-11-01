syms x
y=(1-x)^3*(5-3*(1-x)^2);
s=int(y,x,0,1);
print(s);
